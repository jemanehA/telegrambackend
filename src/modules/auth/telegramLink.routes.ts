import { Router } from "express";
import { requestLinkCode, confirmLinkCode } from "./telegramLink.controller";

const r = Router();

r.post("/telegram/request-code", requestLinkCode);
r.post("/telegram/confirm-code", confirmLinkCode);

export default r;