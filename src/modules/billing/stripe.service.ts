import Stripe from "stripe";
import { env } from "../../config/env";

export const stripe = new Stripe(env.stripe.secretKey, {
  apiVersion: "2023-10-16",
});
