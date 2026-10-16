/** Side panel entry: start the session, page watch and pill intents, then render. */
import { render } from "preact";
import { App } from "./shell/App";
import { startIntents } from "./state/intents";
import { startPageWatch } from "./state/page";
import { startSession } from "./state/session";
import { uiLocale } from "./platform/i18n";

document.documentElement.lang = uiLocale().split("-")[0] || "en";

startSession();
startPageWatch();
startIntents();

const root = document.getElementById("app");
if (root) render(<App />, root);
