const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');

const saltRounds = 10;

// Create or open database
const db = new Database('./database.db');

function initializeDatabase() {
  try {
    // Create users table
    db.prepare(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT,
        email TEXT UNIQUE,
        password TEXT,
        isAdmin BOOLEAN,
        balance REAL,
        subscribed BOOLEAN,
        tier INTEGER,
        address TEXT
      )
    `).run();

    // Default admin values
    const defaultAdmin = {
      id: 'tesla_ai',
      name: 'TESLAAI Support',
      email: 'tesla_ai@gmail.com',
      password: process.env.ADMIN_PASSWORD || '@David081',
      isAdmin: 1,
      balance: 999999,
      subscribed: 1,
      tier: 1,
      address: ''
    };

    // Check if admin exists
    const exists = db.prepare(`SELECT id FROM users WHERE id = ?`).get(defaultAdmin.id);

    if (!exists) {
      const hashedPassword = bcrypt.hashSync(defaultAdmin.password, saltRounds);

      db.prepare(`
        INSERT INTO users (id, name, email, password, isAdmin, balance, subscribed, tier, address)
        VALUES (@id, @name, @email, @password, @isAdmin, @balance, @subscribed, @tier, @address)
      `).run({
        ...defaultAdmin,
        password: hashedPassword
      });

      console.log("Default admin created.");
    } else {
      console.log("Admin already exists.");
    }

    return db;

  } catch (error) {
    console.error("Failed to initialize database:", error);
    throw error;
  }
}

module.exports = initializeDatabase;
