import mysql from "mysql2/promise";
import { env } from "./env";

export const db = mysql.createPool({
  host: env.db.host,
  user: env.db.user,
  password: env.db.pass,
  database: env.db.name,
  waitForConnections: true,
  connectionLimit: 10,
});
