// ================================================================
// Sprint D-8 — Customer-side chat routes.
//
// Mounted at /api/customer/chat.
//
// /messages  POST    auth     — persist user message, return streamToken
// /stream    GET     token    — SSE stream (token in ?token=)
// (B.5/B.6 add /conversations CRUD, messages list, /actions/:type)
// ================================================================
import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { chatStreamController } from "../../controllers/customer/chatStreamController";

const router = Router();

// /stream is intentionally NOT auth-protected — it uses the
// short-lived JWT in ?token= as its credential (EventSource API
// limitation: cannot send Authorization headers).
router.get("/stream", chatStreamController.stream);

// All other endpoints require Bearer auth.
router.use(authenticate);

router.post("/messages", chatStreamController.postMessage);

export default router;
