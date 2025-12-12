const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const db = new sqlite3.Database('./database.db');

const saltRounds = 10;

function initializeDatabase() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT,
        email TEXT UNIQUE,
        password TEXT,
        isAdmin BOOLEAN,
        balance REAL,
        subscribed BOOLEAN,
        tier INTEGER,
        address TEXT
      )`, (err) => {
        if (err) return reject(err);
      });

      const defaultAdmin = {
        id: 'tesla_ai',
        name: 'TESLAAI Support',
        email: 'tesla_ai',
        password: process.env.ADMIN_PASSWORD || '@David081',
        isAdmin: true,
        balance: 999999,
        subscribed: true,
        tier: 1,
        address: ''
      };

      bcrypt.hash(defaultAdmin.password, saltRounds, (err, hash) => {
        if (err) {
          console.error('Error hashing password:', err);
          return reject(err);
        }
        const { id, name, email, isAdmin, balance, subscribed, tier, address } = defaultAdmin;
        db.run('INSERT OR IGNORE INTO users VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, name, email, hash, isAdmin, balance, subscribed, tier, address], (err) => {
          if (err) return reject(err);
          resolve(db);
        });
      });
    });
  });
}

module.exports = initializeDatabase;
