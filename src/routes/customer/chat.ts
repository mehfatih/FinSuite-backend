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
import { chatConversationsController } from "../../controllers/customer/chatConversationsController";
import { chatActionsController } from "../../controllers/customer/chatActionsController";

const router = Router();

// /stream is intentionally NOT auth-protected — it uses the
// short-lived JWT in ?token= as its credential (EventSource API
// limitation: cannot send Authorization headers).
router.get("/stream", chatStreamController.stream);

// All other endpoints require Bearer auth.
router.use(authenticate);

router.post("/messages", chatStreamController.postMessage);

router.get   ("/conversations",                chatConversationsController.list);
router.post  ("/conversations",                chatConversationsController.create);
router.get   ("/conversations/:id",            chatConversationsController.getById);
router.patch ("/conversations/:id",            chatConversationsController.update);
router.delete("/conversations/:id",            chatConversationsController.remove);
router.get   ("/conversations/:id/messages",   chatConversationsController.listMessages);

router.post  ("/actions/:type",                chatActionsController.execute);

export default router;
