import { createApp } from "./app";
import { env } from "./config/env";

const app = createApp();
app.listen(env.port, () => {
  console.log(`API running at ${env.baseUrl} (port ${env.port})`);
});
