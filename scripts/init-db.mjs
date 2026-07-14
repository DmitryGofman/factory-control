// יצירת הסכמה ב-DB. הרצה: npm run db:init (קורא DATABASE_URL מ-.env.local או מהסביבה)
try { process.loadEnvFile(".env.local"); } catch { /* אין קובץ — נשתמש בסביבה */ }

const { db } = await import("../lib/db.js");
const pool = await db();
console.log("הסכמה קיימת/נוצרה בהצלחה.");
await pool.end();
