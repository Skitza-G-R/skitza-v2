// ─── Project Router (stubbed during C.1 schema rename) ─────────────
// The full projects router is being rewritten as `dealRouter` in C.2
// after the projects→deals table rename lands. During the interim
// C.1 commit we stub this router to the empty shape so the rest of
// the app keeps typechecking; any caller that hits a project.*
// procedure will get a 404 at runtime. The `/dashboard/projects`
// dashboard directory is parked at `_projects.disabled` for the same
// reason and will be revived (as `/dashboard/deals`) in C.3.
import { router } from "../init";

export const projectRouter = router({});
