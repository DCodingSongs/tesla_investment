const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const initializeDatabase = require('./database');

const { sendEmail } = require('./mailer');

const saltRounds = 10;

// --- Configuration ---
const PORT = process.env.PORT || 10000;
// Note: This key is used for JWT token signing for client logins (login.html/register.html)
const SECRET_KEY = process.env.JWT_SECRET || 'a-very-secret-key-that-must-be-long-and-secure'; 
const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});



// app.use(cors({
//     origin: [
//         "https://telsa-ai.org",
//         "https://www.telsa-ai.org"
//     ],
//     methods: ["GET", "POST", "PUT", "DELETE"],
//     allowedHeaders: ["Content-Type", "Authorization"],
//     credentials: true
// }));

// --- Middleware ---
app.use(bodyParser.json());
app.use(express.static(__dirname));

// --- Database (In-Memory) ---
// UPDATED ADMIN CREDENTIALS: username: tesla_ai / password: @David081
// Registered clients are stored here (in-memory, lost on server restart)

// Message history stored by client ID
// { "client1@example.com": [ {message}, {message} ], "client2@example.com": [...] }
let chatHistoryByClient = {}; 
let activeConnections = {}; // Track currently connected sockets by userId

// --- Helper Functions ---


function findUser(db, email, password = null) {
    try {
        // synchronous query to get the user by email
        const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
   

        if (!user) return Promise.resolve(null);

        // If password provided, compare it
        if (password) {
            return new Promise((resolve) => {
                bcrypt.compare(password, user.password, (err, match) => {
                    if (err) return resolve(null);
                    resolve(match ? user : null);
                });
            });
        }

        // No password check needed
        return Promise.resolve(user);

    } catch (err) {
        console.error('Database error:', err);
        return Promise.resolve(null);
    }
}

function userExists(db, email) {
    return new Promise((resolve, reject) => {
        db.get('SELECT 1 FROM users WHERE email = ?', [email], (err, row) => {
            if (err) {
                console.error('Database error:', err);
                return resolve(false);
            }
            resolve(!!row);
        });
    });
}

function getTimestamp() {
    return new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function adminRequired(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ success: false, message: 'Authorization header required.' });
    }
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        if (!decoded.isAdmin) {
            return res.status(403).json({ success: false, message: 'Forbidden.' });
        }
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(403).json({ success: false, message: 'Invalid or expired token.' });
    }
}


// --- JWT Authentication Middleware for Socket.IO (Clients) ---

io.use((socket, next) => {
    const token = socket.handshake.query.token;

    if (token) {
        try {
            // Check if the token is valid
            const decoded = jwt.verify(token, SECRET_KEY);
            socket.userData = decoded;
            return next();
        } catch (err) {
            // *** FIXED: Added backtick (`) to open the template literal ***
            console.error(`[${getTimestamp()}] Socket Auth Error: Invalid token. Error: ${err.message}`);
            // Only reject connection if authentication token is invalid
            return next(new Error('Authentication error: Invalid token'));
        }
    }
    // If no token, allow connection (for anonymous clients or admin key-based access)
    return next();
});


// --- Express Authentication Routes (For login.html and register.html) ---

function initializeRoutes(db) {
    app.get('/api/v1/users', (req, res) => {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return res.status(401).json({ success: false, message: 'Authorization header required.' });
        }
        const token = authHeader.split(' ')[1];
    
        try {
            const decoded = jwt.verify(token, SECRET_KEY);
            
            if (!decoded.isAdmin) {
                return res.status(403).json({ success: false, message: 'Forbidden.' });
            }
            
           try {
     const stmt = db.prepare(
        'SELECT id, name, email, balance, tier FROM users'
    );

    const rows = stmt.all(); // synchronous


    return res.json({
        success: true,
        users: rows
    });

} catch (err) {
    console.error('Database error:', err);
    return res.status(500).json({
        success: false,
        message: 'Failed to fetch users.'
    });
}

        } catch (err) {
            return res.status(403).json({ success: false, message: 'Invalid or expired token.' });
        }
    });

    app.post('/api/v1/users', async (req, res) => {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return res.status(401).json({ success: false, message: 'Authorization header required.' });
        }
        const token = authHeader.split(' ')[1];
        try {
            const decoded = jwt.verify(token, SECRET_KEY);
            if (!decoded.isAdmin) {
                return res.status(403).json({ success: false, message: 'Forbidden.' });
            }
            const { name, email, password } = req.body;
            const existingUser = db.prepare('SELECT 1 FROM users WHERE email = ?').get(email);
            if (existingUser) {
                return res.status(400).json({ success: false, message: 'User already exists.' });
            }
            const hash = await bcrypt.hash(password, saltRounds);
            const newUser = {
                id: email,
                name,
                email,
                password: hash,
                isAdmin: 0,
                balance: 0,
                address: '',
                subscribed: 0,
                tier: 0
            };
            db.prepare(`
                INSERT INTO users (id, name, email, password, isAdmin, balance, address, subscribed, tier)
                VALUES (@id, @name, @email, @password, @isAdmin, @balance, @address, @subscribed, @tier)
            `).run(newUser);
            const { password: _, ...safeUserData } = newUser;
            res.status(201).json({ success: true, user: safeUserData });
        } catch (err) {
            return res.status(403).json({ success: false, message: 'Invalid or expired token.' });
        }
    });

    app.put('/api/v1/users/:id', (req, res) => {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return res.status(401).json({ success: false, message: 'Authorization header required.' });
        }
        const token = authHeader.split(' ')[1];
        try {
            const decoded = jwt.verify(token, SECRET_KEY);
            if (!decoded.isAdmin) {
                return res.status(403).json({ success: false, message: 'Forbidden.' });
            }
            const { name, email, balance, tier } = req.body;
            // console.log('Updating user:', req.params.id, name, email, balance, tier);
            db.prepare('UPDATE users SET name = ?, email = ?, balance = ?, tier = ? WHERE id = ?').run(name, email, balance, tier, req.params.id);
            res.json({ success: true });
        } catch (err) {
            return res.status(403).json({ success: false, message: 'Invalid or expired token.' });
        }
    });

    app.delete('/api/v1/users/:id', (req, res) => {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return res.status(401).json({ success: false, message: 'Authorization header required.' });
        }
        const token = authHeader.split(' ')[1];
        try {
            const decoded = jwt.verify(token, SECRET_KEY);
            if (!decoded.isAdmin) {
                return res.status(403).json({ success: false, message: 'Forbidden.' });
            }
            db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
            res.json({ success: true });
        } catch (err) {
            return res.status(403).json({ success: false, message: 'Invalid or expired token.' });
        }
    });

    // Placeholder for /api/v1/profile/me
    app.get('/api/v1/profile/me', (req, res) => {
    // A simple JWT verification middleware would be needed here in a real app.
    // For this simulation, we'll just extract the token from the header manually.
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ success: false, message: 'Authorization header required.' });
    }
    const token = authHeader.split(' ')[1];
    
    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        db.get('SELECT * FROM users WHERE id = ?', [decoded.id], (err, user) => {
            if (err || !user) {
                return res.status(404).json({ success: false, message: 'User not found.' });
            }
            const { password, ...safeUserData } = user;
            return res.json(safeUserData);
        });
    } catch (err) {
        return res.status(403).json({ success: false, message: 'Invalid or expired token.' });
    }
});

// Placeholder for /api/v1/profile/update
app.post('/api/v1/profile/update', (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ success: false, message: 'Authorization header required.' });
    }
    const token = authHeader.split(' ')[1];
    
  try {
        const decoded = jwt.verify(token, SECRET_KEY);
        const { name, address, newPassword } = req.body;

        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

        const newName = name || user.name;
        const newAddress = address || user.address;

        let finalPassword = user.password;

        if (newPassword) {
            if (newPassword.length < 8) return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' });
            finalPassword = bcrypt.hashSync(newPassword, saltRounds);
        }

        db.prepare('UPDATE users SET name = ?, address = ?, password = ? WHERE id = ?')
          .run(newName, newAddress, finalPassword, decoded.id);

        const { password, ...safeUserData } = { ...user, name: newName, address: newAddress };
        return res.json({ success: true, message: 'Profile updated.', ...safeUserData });

    } catch (err) {
        return res.status(403).json({ success: false, message: 'Invalid or expired token.' });
    }
});


app.post('/api/v1/auth/login', async (req, res) => {
    const { email, password } = req.body;
    
    
    const user = await findUser(db, email, password);

    if (user) {
        const token = jwt.sign(
            { id: user.id, email: user.email, isAdmin: user.isAdmin }, 
            SECRET_KEY, 
            { expiresIn: '24h' }
        );

        const { password, ...safeUserData } = user;

        return res.json({
            success: true,
            message: 'Login successful.',
            token: token,
            user: safeUserData
        });
    }

    return res.status(401).json({ 
        success: false,
        message: 'Invalid email or password.' 
    });
});

app.post('/api/v1/auth/signup', async (req, res) => {
    const { name, email, password } = req.body;

    try {
        // Check if user exists (synchronously)
        const existingUser = db.prepare('SELECT 1 FROM users WHERE email = ?').get(email);
        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: 'User already exists with this email address.'
            });
        }

        // Hash password
        const hash = await bcrypt.hash(password, saltRounds);

        // Create new user object
        const newUser = {
            id: email,
            name,
            email,
            password: hash,
            isAdmin: 0,      // 0 = false
            balance: 200,    // initial bonus
            address: '',
            subscribed: 0,   // 0 = false
            tier: 0
        };

        // Insert user into DB
        db.prepare(`
            INSERT INTO users (id, name, email, password, isAdmin, balance, address, subscribed, tier)
            VALUES (@id, @name, @email, @password, @isAdmin, @balance, @address, @subscribed, @tier)
        `).run(newUser);

        // Initialize chat history
        chatHistoryByClient[newUser.id] = [];

        // Remove password before sending response
        const { password: _, ...safeUserData } = newUser;

        return res.status(201).json({
            success: true,
            message: 'Sign up successful.',
            user: safeUserData,
            redirect: '/login.html'
        });

    } catch (err) {
        console.error('Signup error:', err);
        return res.status(500).json({ success: false, message: 'Failed to create user.' });
    }
});

app.post('/api/v1/auth/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;

        const user = db.prepare(
            'SELECT * FROM users WHERE email = ?'
        ).get(email);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found.'
            });
        }

        const token = crypto.randomBytes(32).toString('hex');
        const expires = Date.now() + 60 * 60 * 1000; // 1 hour

        db.prepare(`
            INSERT OR REPLACE INTO password_resets (email, token, expires)
            VALUES (?, ?, ?)
        `).run(email, token, expires);

        const resetLink = `${process.env.APP_URL}/reset_password.html?token=${token}`;

        await sendEmail({
            to: email,
            subject: 'Password Reset Request',
            html: `
                <p>Hello ${user.name},</p>
                <p>You requested a password reset.</p>
                <p>
                    <a href="${resetLink}" style="padding:10px 15px;background:#2563eb;color:#fff;text-decoration:none;border-radius:4px">
                        Reset Password
                    </a>
                </p>
                <p>This link expires in 1 hour.</p>
                <p>If you did not request this, ignore this email.</p>
            `
        });

        res.json({
            success: true,
            message: 'Password reset link sent to your email.'
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({
            success: false,
            message: 'Failed to send reset email.'
        });
    }
});

app.post('/api/v1/auth/reset-password', async (req, res) => {
    const { token, password } = req.body;
    const reset = db.prepare('SELECT * FROM password_resets WHERE token = ?').get(token);

    if (!reset || reset.expires < Date.now()) {
        return res.status(400).json({ success: false, message: 'Invalid or expired token.' });
    }

    const hash = await bcrypt.hash(password, saltRounds);
    db.prepare('UPDATE users SET password = ? WHERE email = ?').run(hash, reset.email);
    db.prepare('DELETE FROM password_resets WHERE token = ?').run(token);

    res.json({ success: true, message: 'Password has been reset successfully.' });
});

app.get('/api/v1/admin/search-user', adminRequired, async (req, res) => {
    const { email } = req.query;
    const user = db.prepare('SELECT id, name, email, balance FROM users WHERE email LIKE ?').get(`%${email}%`);
    if (user) {
        res.json({ success: true, user });
    } else {
        res.status(404).json({ success: false, message: 'User not found.' });
    }
});

app.post('/api/v1/admin/confirm-payment', adminRequired, async (req, res) => {
    const { userId } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) {
        return res.status(404).json({ success: false, message: 'User not found.' });
    }
    const newBalance = user.balance + (user.tier * 1000); // Example payment logic
    db.prepare('UPDATE users SET balance = ?, subscribed = 1 WHERE id = ?').run(newBalance, userId);

    const subscription = {
        userId,
        date: new Date().toISOString().split('T')[0],
        amount: (user.tier * 1000),
        type: `Tier ${user.tier} Payment`
    };
    db.prepare('INSERT INTO subscriptions (userId, date, amount, type) VALUES (?, ?, ?, ?)').run(subscription.userId, subscription.date, subscription.amount, subscription.type);

    res.json({ success: true, newBalance });
});

app.post('/api/v1/transactions/deposit', (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ success: false, message: 'Authorization header required.' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        const { amount, type, status } = req.body;

        db.prepare(
            'INSERT INTO deposits (userId, date, amount, type, status) VALUES (?, ?, ?, ?, ?)'
        ).run(decoded.id, new Date().toISOString().split('T')[0], amount, type, status);

        res.status(201).json({ success: true, message: 'Deposit recorded.' });
    } catch (err) {
        return res.status(403).json({ success: false, message: 'Invalid or expired token.' });
    }
});

app.post('/api/v1/transactions/withdraw', (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ success: false, message: 'Authorization header required.' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        const { amount, type, status } = req.body;

        db.prepare(
            'INSERT INTO withdrawals (userId, date, amount, type, status) VALUES (?, ?, ?, ?, ?)'
        ).run(decoded.id, new Date().toISOString().split('T')[0], amount, type, status);

        res.status(201).json({ success: true, message: 'Withdrawal recorded.' });
    } catch (err) {
        return res.status(403).json({ success: false, message: 'Invalid or expired token.' });
    }
});

app.get('/api/v1/transactions', (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ success: false, message: 'Authorization header required.' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, SECRET_KEY);

        const deposits = db.prepare('SELECT * FROM deposits WHERE userId = ?').all(decoded.id);
        const withdrawals = db.prepare('SELECT * FROM withdrawals WHERE userId = ?').all(decoded.id);
        const subscriptions = db.prepare('SELECT * FROM subscriptions WHERE userId = ?').all(decoded.id);

        const transactions = [...deposits, ...withdrawals, ...subscriptions].sort((a, b) => new Date(b.date) - new Date(a.date));

        res.json({ success: true, transactions });
    } catch (err) {
        return res.status(403).json({ success: false, message: 'Invalid or expired token.' });
    }
});

app.get('/api/v1/subscriptions', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ success: false, message: 'Authorization header required.' });
    }
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 10;
        const offset = (page - 1) * limit;

        const subscriptions = db.prepare('SELECT * FROM subscriptions WHERE userId = ? LIMIT ? OFFSET ?').all(decoded.id, limit, offset);
        const total = db.prepare('SELECT COUNT(*) as count FROM subscriptions WHERE userId = ?').get(decoded.id).count;

        res.json({
            success: true,
            subscriptions,
            total,
            page,
            limit
        });
    } catch (err) {
        return res.status(403).json({ success: false, message: 'Invalid or expired token.' });
    }
});
}


// --- Socket.IO Connection Logic (Chat Server) ---

let adminUserId;

function initializeServer(db) {
    initializeRoutes(db);
}


// --- Start Server ---
try {
    const db = initializeDatabase(); // sync

    // Fetch admin (better-sqlite3 style)
    const row = db.prepare('SELECT id FROM users WHERE isAdmin = 1').get();

    if (!row) {
        console.error('Admin user not found in the database.');
        process.exit(1);
    }

    adminUserId = row.id;

    initializeServer(db);

    server.listen(PORT, () => {
        console.log(`Chat server listening on port ${PORT}`);
       
    });

} catch (err) {
    console.error('Failed to initialize database:', err);
    process.exit(1);
}
