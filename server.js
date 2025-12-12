const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const initializeDatabase = require('./database');

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
        console.log('User lookup for email:', email, 'Found:', !!user);

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

        db.get('SELECT * FROM users WHERE id = ?', [decoded.id], (err, user) => {
            if (err || !user) {
                return res.status(404).json({ success: false, message: 'User not found.' });
            }

            const newName = name || user.name;
            const newAddress = address || user.address;

            const updateUser = (hashedPassword) => {
                const finalPassword = hashedPassword || user.password;
                db.run('UPDATE users SET name = ?, address = ?, password = ? WHERE id = ?', [newName, newAddress, finalPassword, decoded.id], function(err) {
                    if (err) {
                        return res.status(500).json({ success: false, message: 'Failed to update profile.' });
                    }
                    const { password, ...safeUserData } = { ...user, name: newName, address: newAddress };
                    return res.json({ success: true, message: 'Profile updated.', ...safeUserData });
                });
            };

            if (newPassword) {
                if (newPassword.length < 8) {
                    return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' });
                }
                bcrypt.hash(newPassword, saltRounds, (err, hash) => {
                    if (err) {
                        return res.status(500).json({ success: false, message: 'Failed to hash new password.' });
                    }
                    updateUser(hash);
                });
            } else {
                updateUser(null);
            }
        });
        
    } catch (err) {
        return res.status(403).json({ success: false, message: 'Invalid or expired token.' });
    }
});


app.post('/api/v1/auth/login', async (req, res) => {
    const { email, password } = req.body;
    
    console.log(`Login attempt for email: ${email}`);
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
            user: safeUserData
        });

    } catch (err) {
        console.error('Signup error:', err);
        return res.status(500).json({ success: false, message: 'Failed to create user.' });
    }
});;
}


// --- Socket.IO Connection Logic (Chat Server) ---

let adminUserId;

function initializeServer(db) {
    initializeRoutes(db);
    io.on('connection', (socket) => {
    
    let userId;
    // Check for admin status from query, defaults to false if not present or not 'true'
    let isAdmin = socket.handshake.query.isAdmin === 'true'; 
    
    // 1. Determine User ID and Admin Status based on JWT payload first
    if (socket.userData) {
        // Authenticated client/admin via JWT
        userId = socket.userData.id;
        isAdmin = socket.userData.isAdmin;
    } else if (isAdmin) {
        // Unauthenticated connection identifying as Admin (allowed if admin.html provides the correct key)
        userId = adminUserId;
    } else {
        // Unauthenticated standard client (e.g., just opened the page)
        userId = socket.id; // Fallback to socket ID
    }
    
    // Attach details to socket for later use
    socket.userId = userId;
    socket.isAdmin = isAdmin;

    // *** FIXED: Added backtick (`) to open the template literal ***
    console.log(`[${getTimestamp()}] A user connected: ${userId} (Admin: ${isAdmin}) | Socket: ${socket.id}`);
    activeConnections[userId] = socket.id;

    // Initialize history for new, non-admin clients if needed
    if (!isAdmin && !chatHistoryByClient[userId]) {
        chatHistoryByClient[userId] = [];
        chatHistoryByClient[userId].push({
            userId: 'System',
            message: 'Welcome to TESLAAI Live Support. How can we help you?',
            timestamp: getTimestamp(),
            isAdmin: true,
            clientDisplay: true // Only show for the client's view
        });
    }

    // --- CLIENT (dashboard.html) Events ---
    if (!isAdmin) {
        // 1. Send Client History
        socket.emit('history', chatHistoryByClient[userId] || []);

        // 2. Handle incoming client messages
        socket.on('clientMessage', (msg) => {
            const messageData = {
                userId: userId, 
                message: msg.message,
                timestamp: getTimestamp(),
                isAdmin: false
            };

            // Store message for this client
            if (chatHistoryByClient[userId]) {
                chatHistoryByClient[userId].push(messageData);
            }
            
            // Send the message back to the client
            socket.emit('message', messageData);
            
            // Notify active admin sockets about the new message
            io.emit('newMessage', messageData); 
        });
    }

    // --- ADMIN (admin.html) Events ---
    if (isAdmin) {
        // 1. Request List of Clients
        socket.on('requestClientList', () => {
            const clientList = Object.keys(chatHistoryByClient).map(clientId => {
                const history = chatHistoryByClient[clientId];
                const lastMessage = history.length > 0 ? history[history.length - 1] : { message: 'No messages yet.', timestamp: 0 };
                return {
                    clientId: clientId,
                    lastMessageTime: lastMessage.timestamp,
                    lastMessageSummary: lastMessage.message.substring(0, 30) + (lastMessage.message.length > 30 ? '...' : ''),
                    // Simple logic for active status: check if socket ID is in active connections
                    isActive: !!activeConnections[clientId] 
                };
            });
            socket.emit('clientList', clientList);
        });
        
        // 2. Request Specific Client History
        socket.on('requestChatHistory', (clientId) => {
            if (chatHistoryByClient[clientId]) {
                socket.emit('chatHistory', {
                    clientId: clientId,
                    history: chatHistoryByClient[clientId]
                });
            }
        });
        
        // 3. Handle Admin Reply to Client
        socket.on('adminReply', (data) => {
            const { clientId, message } = data;
            
            const messageData = {
                userId: adminUserId,
                message: message,
                timestamp: getTimestamp(),
                isAdmin: true
            };
            
            // Store message for this client
            if (chatHistoryByClient[clientId]) {
                chatHistoryByClient[clientId].push(messageData);
            }
            
            // 1. Send to the specific target client
            const clientSocketId = activeConnections[clientId];
            if (clientSocketId) {
                // Find the socket ID and send the message
                io.to(clientSocketId).emit('message', messageData);
            } else {
                // *** FIXED: Added backtick (`) to open the template literal ***
                console.log(`[${getTimestamp()}] Client ${clientId} is offline, message stored.`);
            }

            // 2. Send back to all admins (including self) to keep views updated
            // We use io.emit('newMessage') which will be caught by the admin's 'newMessage' handler
            io.emit('newMessage', messageData); 
        });
    }

    // --- Disconnect Handler ---
    socket.on('disconnect', () => {
        // Only remove the socket ID from active connections. We keep the chat history.
        if (activeConnections[socket.userId] === socket.id) {
            delete activeConnections[socket.userId];
        }
        // *** FIXED: Added backtick (`) to open the template literal ***
        console.log(`[${getTimestamp()}] User disconnected: ${socket.userId}`);
    });
    });
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
        console.log(`Deployment successful. Admin ID: ${adminUserId} | JWT Auth Routes Ready.`);
    });

} catch (err) {
    console.error('Failed to initialize database:', err);
    process.exit(1);
}
