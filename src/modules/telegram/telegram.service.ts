import { Telegraf } from "telegraf";
import { env } from "../../config/env";

export const bot = new Telegraf(env.telegram.botToken);

export async function createSingleUseInviteLink() {
  // Requires bot admin rights in the group + permission to create invite links
  const res = await bot.telegram.createChatInviteLink(env.telegram.groupChatId, {
    member_limit: 1,
  });
  return res.invite_link;
}
