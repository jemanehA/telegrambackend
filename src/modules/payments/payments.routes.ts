import { Router } from "express";
import { getUserPayments, getPaymentStats, getInvoice } from "./payments.controller";
import { asyncHandler } from "../../utils/asyncHandler";

const r = Router();

r.get("/stats", asyncHandler(getPaymentStats));
r.get("/invoice/:invoiceId", asyncHandler(getInvoice));
r.get("/user/:userId", asyncHandler(getUserPayments));

export default r;

