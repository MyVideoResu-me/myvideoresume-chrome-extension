/** The recruiter's talent pool (My content › Candidates). */
import { fetchTalentPool } from "../api/recruiter";
import { createListLoader } from "./list-store";

export const candidates = createListLoader(fetchTalentPool);
