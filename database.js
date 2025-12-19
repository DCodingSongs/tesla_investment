const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const path = require('path');

const saltRounds = 10;
// const dbPath = path.join(__dirname, 'database.db');

const dbPath = process.env.RENDER 
    ? '/var/data/database.db' 
    : path.join(__dirname, 'database.db');

// Create or open database
const db = new Database(dbPath);
// const db = new Database('./database.db');
db.pragma('journal_mode = WAL');

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
        totalProfit REAL,
        subscribed BOOLEAN,
        tier INTEGER,
        address TEXT,
        activeInvestment REAL,
        nextPayout TEXT
      )
    `).run();

    db.prepare(`
      CREATE TABLE IF NOT EXISTS password_resets (
        email TEXT PRIMARY KEY,
        token TEXT NOT NULL,
        expires INTEGER NOT NULL
      )
    `).run();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            userId TEXT NOT NULL,
            date TEXT NOT NULL,
            amount REAL NOT NULL,
            type TEXT NOT NULL,
            FOREIGN KEY (userId) REFERENCES users(id)
        )
    `).run();

    // Default admin values
    const defaultAdmin = {
      id: 'tesla_aiw',
      name: 'TESLAAI Support',
      email: 'tesla_ai@support.com',
      password: process.env.ADMIN_PASSWORD || '@David081',
      isAdmin: 1,
      balance: 999,
      totalProfit: 0,
      subscribed: 1,
      tier: 1,
      address: ''
    };

    // Check if admin exists
    const exists = db.prepare(`SELECT id FROM users WHERE id = ?`).get(defaultAdmin.id);

    if (!exists) {
      const hashedPassword = bcrypt.hashSync(defaultAdmin.password, saltRounds);

      db.prepare(`
        INSERT INTO users (id, name, email, password, isAdmin, balance, subscribed, tier, address, totalProfit, activeInvestment, nextPayout)
        VALUES (@id, @name, @email, @password, @isAdmin, @balance, @subscribed, @tier, @address, @totalProfit, 0, NULL)
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
