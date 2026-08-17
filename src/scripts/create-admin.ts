import bcrypt from "bcryptjs";
import { db } from "../config/db";

async function createAdmin() {
  const args = process.argv.slice(2);
  
  if (args.length < 3) {
    console.log("Usage: ts-node src/scripts/create-admin.ts <username> <email> <password> [full_name]");
    process.exit(1);
  }

  const [username, email, password, full_name] = args;

  try {
    // Check if admin already exists
    const [existing]: any = await db.query(
      `SELECT id FROM admin_users WHERE username = ? OR email = ? LIMIT 1`,
      [username, email]
    );

    if (existing?.[0]) {
      console.error("❌ Admin user with this username or email already exists");
      process.exit(1);
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create admin user
    const [result]: any = await db.query(
      `INSERT INTO admin_users (username, email, password_hash, full_name) 
       VALUES (?, ?, ?, ?)`,
      [username, email, passwordHash, full_name || null]
    );

    console.log("✅ Admin user created successfully!");
    console.log(`   ID: ${result.insertId}`);
    console.log(`   Username: ${username}`);
    console.log(`   Email: ${email}`);
    console.log(`   Full Name: ${full_name || "N/A"}`);
  } catch (err: any) {
    console.error("❌ Failed to create admin user:", err.message);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

createAdmin();

