// content-script-autofill.js — Form field detection and filling for job applications.
// Message-driven: does NOT auto-execute on page load. Only activates when the
// sidepanel sends an 'extractFormFields' or 'fillFormFields' message.

// Idempotency guard: this script is injected programmatically by
// service-worker-base.js whenever the sidepanel asks for form fields on a
// tab that didn't have the listener yet. Repeated asks (e.g. user clicks
// "Autofill" twice) can race and re-evaluate this file, which would
// SyntaxError on the `const ATS_URL_PATTERNS` below and double-register
// the message listener at the bottom. Wrapping in an IIFE with a
// window sentinel makes the second evaluation a cheap no-op.
(function hiredVideoAutofillContentScript() {
  if (window.__HIRED_VIDEO_AUTOFILL_CS_LOADED__) return;
  window.__HIRED_VIDEO_AUTOFILL_CS_LOADED__ = true;

// ============================================================================
// ATS DETECTION
// ============================================================================

const ATS_URL_PATTERNS = {
  greenhouse: /boards\.greenhouse\.io|\.greenhouse\.io/i,
  lever: /jobs\.lever\.co/i,
  workday: /\.myworkdayjobs\.com|\.myworkdaysite\.com/i,
  ashby: /jobs\.ashbyhq\.com/i,
  smartrecruiters: /jobs\.smartrecruiters\.com/i,
  icims: /\.icims\.com/i,
  bamboohr: /\.bamboohr\.com\/careers/i,
};

function detectAtsProvider() {
  const url = window.location.href;
  for (const [provider, pattern] of Object.entries(ATS_URL_PATTERNS)) {
    if (pattern.test(url)) return provider;
  }
  return null;
}

// ============================================================================
// LABEL RESOLUTION
// ============================================================================

/**
 * Resolve the label for a form element using multiple strategies.
 * Priority: explicit <label for> → implicit parent <label> → aria-label →
 * aria-labelledby → placeholder → sibling text → name attribute.
 */
function resolveLabel(el) {
  // 1. Explicit <label for="id">
  if (el.id) {
    const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label) {
      const text = label.textContent.trim().replace(/\s+/g, ' ');
      if (text) return text;
    }
  }

  // 2. Implicit parent <label>
  const parentLabel = el.closest('label');
  if (parentLabel) {
    // Get text nodes only (exclude the input element's own text)
    const clone = parentLabel.cloneNode(true);
    const inputs = clone.querySelectorAll('input, select, textarea');
    inputs.forEach(inp => inp.remove());
    const text = clone.textContent.trim().replace(/\s+/g, ' ');
    if (text) return text;
  }

  // 3. aria-label
  if (el.getAttribute('aria-label')) {
    return el.getAttribute('aria-label').trim();
  }

  // 4. aria-labelledby
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelEl = document.getElementById(labelledBy);
    if (labelEl) {
      const text = labelEl.textContent.trim().replace(/\s+/g, ' ');
      if (text) return text;
    }
  }

  // 5. Placeholder
  if (el.placeholder) return el.placeholder.trim();

  // 6. Nearby sibling or parent text
  const wrapper = el.closest('.field, .form-group, .form-field, [class*="field"], [class*="question"]');
  if (wrapper) {
    const heading = wrapper.querySelector('label, .label, h3, h4, legend, [class*="label"], [class*="question"]');
    if (heading) {
      const text = heading.textContent.trim().replace(/\s+/g, ' ');
      if (text && text.length < 200) return text;
    }
  }

  // 7. name attribute, humanized
  if (el.name) return humanizeFieldName(el.name);

  return 'Unknown Field';
}

/** Convert "job_application[first_name]" → "First Name". */
function humanizeFieldName(name) {
  const bracketMatch = name.match(/\[([^\]]+)\]$/);
  const raw = bracketMatch ? bracketMatch[1] : name;
  return raw
    .replace(/[_\-]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim() || 'Unknown Field';
}

/** Build a unique CSS selector for an element. */
function buildSelector(el) {
  if (el.id) return `#${CSS.escape(el.id)}`;
  if (el.name) return `${el.tagName.toLowerCase()}[name="${CSS.escape(el.name)}"]`;

  // Fallback: path from closest ancestor with id
  const parts = [];
  let current = el;
  while (current && current !== document.body) {
    if (current.id) {
      parts.unshift(`#${CSS.escape(current.id)}`);
      break;
    }
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        parts.unshift(`${current.tagName.toLowerCase()}:nth-of-type(${index})`);
      } else {
        parts.unshift(current.tagName.toLowerCase());
      }
    }
    current = parent;
  }
  return parts.join(' > ') || el.tagName.toLowerCase();
}

/** Check if an element is visible. */
function isVisible(el) {
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
    && el.offsetWidth > 0 && el.offsetHeight > 0;
}

/** Map HTML input type to our FormField type. */
function mapInputType(el) {
  if (el.tagName === 'TEXTAREA') return 'textarea';
  if (el.tagName === 'SELECT') return 'select';
  const type = (el.type || 'text').toLowerCase();
  const map = {
    text: 'text', email: 'email', tel: 'tel', url: 'url',
    date: 'date', 'datetime-local': 'date', number: 'number',
    file: 'file', hidden: 'hidden', radio: 'radio', checkbox: 'checkbox',
    password: 'text',
  };
  return map[type] || 'text';
}

// ============================================================================
// ATS-SPECIFIC EXTRACTORS (TIER 1)
// ============================================================================

const ATS_EXTRACTORS = {
  greenhouse() {
    const form = document.querySelector('#application_form, form[action*="greenhouse"]');
    if (!form) return null;

    const fields = [];
    const inputs = form.querySelectorAll('input, select, textarea');
    const seenNames = new Set();

    for (const el of inputs) {
      if (!isVisible(el) && el.type !== 'hidden') continue;
      const type = (el.type || '').toLowerCase();
      if (['submit', 'button', 'reset', 'hidden'].includes(type)) continue;
      if (el.name && el.name.startsWith('authenticity_token')) continue;

      const name = el.name || el.id || '';
      if (!name || seenNames.has(name)) continue;
      seenNames.add(name);

      const options = el.tagName === 'SELECT'
        ? Array.from(el.options).map(o => o.text.trim()).filter(t => t && t !== 'Select...' && t !== '-- Select --')
        : undefined;

      fields.push({
        id: name,
        label: resolveLabel(el),
        type: mapInputType(el),
        name,
        required: el.required || el.getAttribute('aria-required') === 'true',
        options: options && options.length > 0 ? options : undefined,
        placeholder: el.placeholder || undefined,
        currentValue: el.value || undefined,
        selector: buildSelector(el),
        category: undefined,
      });
    }

    return fields.length > 0 ? fields : null;
  },

  lever() {
    const form = document.querySelector('form.posting-apply, form[action*="lever"]');
    if (!form) return null;

    const fields = [];
    const inputs = form.querySelectorAll('input, select, textarea');
    const seenNames = new Set();

    for (const el of inputs) {
      if (!isVisible(el) && el.type !== 'hidden') continue;
      const type = (el.type || '').toLowerCase();
      if (['submit', 'button', 'reset', 'hidden'].includes(type)) continue;

      const name = el.name || el.id || '';
      if (!name || seenNames.has(name)) continue;
      seenNames.add(name);

      const options = el.tagName === 'SELECT'
        ? Array.from(el.options).map(o => o.text.trim()).filter(t => t && t !== 'Select...')
        : undefined;

      fields.push({
        id: name,
        label: resolveLabel(el),
        type: mapInputType(el),
        name,
        required: el.required,
        options: options && options.length > 0 ? options : undefined,
        placeholder: el.placeholder || undefined,
        currentValue: el.value || undefined,
        selector: buildSelector(el),
        category: undefined,
      });
    }

    return fields.length > 0 ? fields : null;
  },

  workday() {
    // Workday uses custom elements and data-automation-id attributes
    const form = document.querySelector('[data-automation-id="jobApplicationForm"], form[data-automation-id]');
    if (!form) return null;

    const fields = [];
    const inputs = form.querySelectorAll('input, select, textarea, [data-automation-id]');
    const seenIds = new Set();

    for (const el of inputs) {
      if (!['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) continue;
      if (!isVisible(el)) continue;
      const type = (el.type || '').toLowerCase();
      if (['submit', 'button', 'reset', 'hidden'].includes(type)) continue;

      const automationId = el.getAttribute('data-automation-id') || '';
      const id = automationId || el.name || el.id || `wd_${fields.length}`;
      if (seenIds.has(id)) continue;
      seenIds.add(id);

      fields.push({
        id,
        label: resolveLabel(el),
        type: mapInputType(el),
        name: el.name || undefined,
        required: el.required || el.getAttribute('aria-required') === 'true',
        placeholder: el.placeholder || undefined,
        currentValue: el.value || undefined,
        selector: automationId ? `[data-automation-id="${CSS.escape(automationId)}"]` : buildSelector(el),
        category: undefined,
      });
    }

    return fields.length > 0 ? fields : null;
  },

  ashby() {
    const form = document.querySelector('form[action*="ashby"], form._form, [class*="ashby-application"]');
    if (!form) return null;
    // Fall through to generic extraction for Ashby — its DOM is dynamic React
    return null;
  },
};

// ============================================================================
// GENERIC EXTRACTOR (TIER 2)
// ============================================================================

function extractGenericFormFields() {
  const forms = document.querySelectorAll('form');
  let bestForm = null;
  let bestFieldCount = 0;

  // Find the form with the most input fields (likely the application form)
  for (const form of forms) {
    const inputCount = form.querySelectorAll('input, select, textarea').length;
    if (inputCount > bestFieldCount) {
      bestFieldCount = inputCount;
      bestForm = form;
    }
  }

  // If no forms found, look for the entire document
  const container = bestForm || document.body;
  const inputs = container.querySelectorAll('input, select, textarea');
  const fields = [];
  const seenIds = new Set();

  for (const el of inputs) {
    if (!isVisible(el)) continue;
    const type = (el.type || '').toLowerCase();
    if (['submit', 'button', 'reset', 'hidden', 'search'].includes(type)) continue;

    // Skip common non-application fields
    const name = (el.name || '').toLowerCase();
    if (name.includes('search') || name.includes('csrf') || name.includes('token')
      || name.includes('captcha') || name.includes('honeypot')) continue;

    const id = el.name || el.id || `field_${fields.length}`;
    if (seenIds.has(id)) continue;
    seenIds.add(id);

    // Handle radio groups — collect options from all radios with same name
    if (type === 'radio') {
      if (el.name && seenIds.has(`radio_${el.name}`)) continue;
      if (el.name) seenIds.add(`radio_${el.name}`);

      const allRadios = container.querySelectorAll(`input[name="${CSS.escape(el.name)}"]`);
      const options = Array.from(allRadios).map(r => {
        const label = resolveLabel(r);
        return r.value || label;
      });

      // Get the group label (usually on the parent fieldset or wrapper)
      const groupWrapper = el.closest('fieldset, .form-group, [class*="field"], [class*="question"]');
      const groupLabel = groupWrapper
        ? (groupWrapper.querySelector('legend, .label, h3, h4, [class*="label"]')?.textContent?.trim() || resolveLabel(el))
        : resolveLabel(el);

      fields.push({
        id: el.name || id,
        label: groupLabel,
        type: 'radio',
        name: el.name || undefined,
        required: el.required,
        options,
        selector: el.name ? `input[name="${CSS.escape(el.name)}"]` : buildSelector(el),
        category: undefined,
      });
      continue;
    }

    // Handle select options
    let options;
    if (el.tagName === 'SELECT') {
      options = Array.from(el.options)
        .map(o => o.text.trim())
        .filter(t => t && !t.match(/^(select|choose|--|pick)/i));
    }

    fields.push({
      id,
      label: resolveLabel(el),
      type: mapInputType(el),
      name: el.name || undefined,
      required: el.required || el.getAttribute('aria-required') === 'true',
      options: options && options.length > 0 ? options : undefined,
      placeholder: el.placeholder || undefined,
      currentValue: el.value || undefined,
      selector: buildSelector(el),
      category: undefined,
    });
  }

  return fields;
}

// ============================================================================
// FORM FIELD EXTRACTION (3-TIER)
// ============================================================================

function extractFormFields() {
  const atsProvider = detectAtsProvider();

  // Tier 1: ATS-specific
  if (atsProvider && ATS_EXTRACTORS[atsProvider]) {
    const atsFields = ATS_EXTRACTORS[atsProvider]();
    if (atsFields && atsFields.length > 0) {
      return { fields: atsFields, atsProvider, url: window.location.href };
    }
  }

  // Tier 2: Generic extraction
  const genericFields = extractGenericFormFields();

  // Only return if we found a meaningful number of fields (>2 suggests a real form, not just a search bar)
  if (genericFields.length > 2) {
    return { fields: genericFields, atsProvider, url: window.location.href };
  }

  return { fields: genericFields, atsProvider, url: window.location.href };
}

// ============================================================================
// FORM FILLING
// ============================================================================

/**
 * Set a value on a form element with framework-compatible event dispatching.
 * Uses native property setters to bypass React/Vue/Angular state management.
 */
function setFieldValue(el, value) {
  const tag = el.tagName;

  if (tag === 'SELECT') {
    // Find the best matching option
    const options = Array.from(el.options);
    const exact = options.find(o => o.value === value || o.text.trim().toLowerCase() === value.toLowerCase());
    const fuzzy = options.find(o => o.text.trim().toLowerCase().includes(value.toLowerCase())
      || value.toLowerCase().includes(o.text.trim().toLowerCase()));
    const match = exact || fuzzy;
    if (match) {
      el.value = match.value;
    } else {
      return false;
    }
  } else if (el.type === 'checkbox') {
    const shouldCheck = ['true', 'yes', '1', 'on'].includes(value.toLowerCase());
    if (el.checked !== shouldCheck) {
      el.click();
    }
    return true;
  } else if (el.type === 'radio') {
    // For radio, we need to find and click the matching radio button
    const name = el.name;
    if (name) {
      const allRadios = document.querySelectorAll(`input[name="${CSS.escape(name)}"]`);
      for (const radio of allRadios) {
        const radioLabel = resolveLabel(radio);
        if (radio.value === value || radioLabel.toLowerCase().includes(value.toLowerCase())
          || value.toLowerCase().includes(radioLabel.toLowerCase())) {
          radio.click();
          return true;
        }
      }
    }
    return false;
  } else {
    // Text, email, tel, url, textarea, number, date
    // Use native property setter to bypass React's synthetic event system
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    )?.set;
    const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    )?.set;

    if (tag === 'TEXTAREA' && nativeTextAreaValueSetter) {
      nativeTextAreaValueSetter.call(el, value);
    } else if (nativeInputValueSetter) {
      nativeInputValueSetter.call(el, value);
    } else {
      el.value = value;
    }
  }

  // Dispatch events for framework compatibility
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur', { bubbles: true }));

  // Also dispatch React-specific events
  const nativeEvent = new Event('input', { bubbles: true });
  Object.defineProperty(nativeEvent, 'simulated', { value: true });
  el.dispatchEvent(nativeEvent);

  return true;
}

/**
 * Fill form fields with provided answers.
 * @param {Object} answersMap - { fieldId: answerText }
 * @returns {Object} - { fieldId: 'filled' | 'skipped' | 'error' } per field
 */
function fillFormFields(answersMap) {
  const results = {};

  for (const [fieldId, answer] of Object.entries(answersMap)) {
    try {
      // Try multiple selector strategies
      let el = null;

      // Strategy 1: by name attribute
      el = document.querySelector(`[name="${CSS.escape(fieldId)}"]`);

      // Strategy 2: by id
      if (!el) el = document.getElementById(fieldId);

      // Strategy 3: by data-automation-id (Workday)
      if (!el) el = document.querySelector(`[data-automation-id="${CSS.escape(fieldId)}"]`);

      // Strategy 4: by any stored selector (passed as fieldId if it looks like a selector)
      if (!el && (fieldId.startsWith('#') || fieldId.startsWith('[') || fieldId.startsWith('.'))) {
        try { el = document.querySelector(fieldId); } catch { /* invalid selector */ }
      }

      if (!el) {
        results[fieldId] = 'skipped';
        continue;
      }

      if (el.type === 'file') {
        results[fieldId] = 'skipped'; // Cannot programmatically fill file inputs
        continue;
      }

      const filled = setFieldValue(el, answer);
      results[fieldId] = filled ? 'filled' : 'skipped';
    } catch (err) {
      results[fieldId] = 'error';
      console.warn(`[autofill] Error filling field "${fieldId}":`, err.message);
    }
  }

  return results;
}

// ============================================================================
// MESSAGE LISTENER
// ============================================================================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extractFormFields') {
    try {
      const result = extractFormFields();
      sendResponse(result);
    } catch (err) {
      console.warn('[autofill] Form extraction error:', err);
      sendResponse({ fields: [], atsProvider: null, url: window.location.href, error: err.message });
    }
    return true; // async response
  }

  if (request.action === 'fillFormFields') {
    try {
      const results = fillFormFields(request.answers || {});
      sendResponse({ results });
    } catch (err) {
      console.warn('[autofill] Form filling error:', err);
      sendResponse({ results: {}, error: err.message });
    }
    return true;
  }

  if (request.action === 'getFormHtml') {
    // Return the HTML of the best candidate application form
    try {
      const forms = document.querySelectorAll('form');
      let bestForm = null;
      let bestFieldCount = 0;
      for (const form of forms) {
        const count = form.querySelectorAll('input, select, textarea').length;
        if (count > bestFieldCount) {
          bestFieldCount = count;
          bestForm = form;
        }
      }
      sendResponse({ html: bestForm ? bestForm.outerHTML : document.body.innerHTML.slice(0, 50000) });
    } catch (err) {
      sendResponse({ html: '', error: err.message });
    }
    return true;
  }
});

})(); // end hiredVideoAutofillContentScript IIFE
