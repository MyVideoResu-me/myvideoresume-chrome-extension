/** The person's Studio projects (My content › Videos). */
import { fetchStudioProjects } from "../api/studio";
import { createListLoader } from "./list-store";

export const videos = createListLoader(fetchStudioProjects);
