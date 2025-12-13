// FIXED: Use window.location.origin for correct deployment API base URL and APPEND the base path
// alert('Dashboard script loaded');
        const API_BASE_URL = `${window.location.origin}/api/v1`; 
        
        // --- DOM Elements ---
        const sidebar = document.getElementById('sidebar');
        const menuToggle = document.getElementById('menuToggle');
        const navLinks = sidebar.querySelectorAll('nav a');
        const pages = document.querySelectorAll('.page-content');
        const logoutButton = document.getElementById('logout-button');
        
        // Profile Elements
        const profileForm = document.getElementById('profileForm');
        const saveProfileBtn = document.getElementById('saveProfileBtn');
        const nameInput = document.getElementById('name');
        const emailInput = document.getElementById('email');
        const addressInput = document.getElementById('address');
        const newPasswordInput = document.getElementById('new-password');
        const profileAvatar = document.getElementById('profile-avatar');
        
        // Chat Elements
        const chatMessages = document.getElementById('chatMessages');
        const chatInput = document.getElementById('chatInput');
        const sendMessageButton = document.getElementById('sendMessageButton');

        // Message box elements
        const messageBox = document.getElementById('messageBox');
        const messageBoxContent = document.getElementById('messageBoxContent');
        const msgTitle = document.getElementById('msgTitle');
        const msgText = document.getElementById('msgText');
        const msgConfirm = document.getElementById('msgConfirm');





function showPage(page) {
    pages.forEach(p => {
        if (p.id === page) {
            p.style.display = 'block';
        } else {
            p.style.display = 'none';
        }
    });
}

// Load the correct page on refresh
window.addEventListener('load', () => {
    const hash = window.location.hash.replace('#', '');
    if (hash) {
        showPage(hash);
        document.querySelector(`a[data-page="${hash}"]`)?.classList.add('active');
    } else {
        showPage('home'); // default page
    }
});




        // Socket connection variable
        let chatSocket = null;

function formatCurrency(amount) {
    // Ensure it's a number
    const num = Number(amount) || 0;
    // Convert to comma-separated string with 2 decimal places
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}


        // --- Auth & Profile Functions ---

        function getItemWithExpiry(key) {
            const itemStr = localStorage.getItem(key);
            if (!itemStr) return null;
            try {
                const item = JSON.parse(itemStr);
                if (Date.now() > item.expiry) {
                    localStorage.removeItem(key);
                    return null;
                }
                return item.value;
            } catch {
                localStorage.removeItem(key);
                return null;
            }
        }

        /**
         * Checks for a valid JWT. If missing, redirects to login.
         */
        function checkAuth() {
            const token = getItemWithExpiry('userToken');
            if (!token) {
                // Not authenticated, redirect to login
                window.location.href = 'login.html'; 
            }
            return token;
        }

        /**
         * Function to set the Bearer token header.
         * @param {string} token 
         */
        function getAuthHeaders(token) {
            return {
                'Content-Type': 'application/json',
                // FIXED: Template literal backticks added here
                'Authorization': `Bearer ${token}`
            };
        }
        
        /**
         * Function to display custom message box (Replaces alert()).
         */
        function showMessageBox(title, text, type) {
            msgTitle.textContent = title;
            msgText.textContent = text;
            messageBoxContent.className = 'message-box-content'; 
            // FIXED: Template literal backticks added here
            messageBoxContent.classList.add(`message-box-${type}`);
            messageBox.style.display = 'flex';
            
            msgConfirm.onclick = () => {
                messageBox.style.display = 'none';
            };
        }

        /**
         * Function to update all profile display elements.
         */
     // === Improved updateUI + loadProfile for development/learning ===\

        function updateUI(name, initials, clientId) {
            // Safely update all places that show name, avatar, client ID
            document.querySelectorAll('#welcome-name, #user-name').forEach(el => {
                el.textContent = name || 'Guest';
            });

            document.querySelectorAll('#user-avatar, #profile-avatar').forEach(el => {
                el.textContent = initials || '?';
            });

            document.querySelectorAll('#client-id-sidebar, #client-id-mobile').forEach(el => {
                el.textContent = clientId || 'DEV-000';
            });

            // Fill profile form if on profile page
            const nameInput = document.getElementById('name');
            const emailInput = document.getElementById('email');
            if (nameInput) nameInput.value = name || '';
            if (emailInput) emailInput.value = localStorage.getItem('clientEmail') || '';
        }

async function loadProfile() {
    // 1. Try to get data saved by login page (works even without backend)
    const user = JSON.parse(localStorage.getItem('user'));
    const name = user ? user.name : null;
    const initials =  user ? user.name.match(/\b(\w)/g).join('').toUpperCase().substring(0, 2) : null;
    const clientId =  user ? user.id : null;
    const email =  user ? user.email : null;

    if (name && clientId) {
        updateUI(name, initials, clientId);
        return
    }

    const nameFromStorage = JSON.parse(localStorage.getItem('clientName')|| 'null');
    const initialsFromStorage =  JSON.parse(localStorage.getItem('clientInitials') ||'null');
    const clientIdFromStorage =  JSON.parse(localStorage.getItem('clientId') || 'null')

    if (nameFromStorage?.value && clientIdFromStorage?.value) {
        updateUI(nameFromStorage?.value, initialsFromStorage?.value || nameFromStorage?.value.substring(0,2).toUpperCase(), clientIdFromStorage?.value);
        return; // Success — no need to hit backend
    }

    // 2. If nothing in localStorage, show dev fallback
    updateUI('Dev User', 'DU', 'TESLA-99999');
}
        // --- Chat Functions ---
        
        function connectChatSocket() {
            const token = checkAuth();
            if (!token) return;
            
            // Disconnect any existing socket before connecting
            if (chatSocket) {
                chatSocket.disconnect();
            }

            chatSocket = io(window.location.origin, {
                query: { token: token }
            });

            chatSocket.on('connect', () => {
                console.log('Socket.IO connected as client.');
                // Request initial history upon connection
                fetchMessages(); 
            });

            chatSocket.on('history', (messages) => {
                chatMessages.innerHTML = '';
                messages.forEach(renderMessage);
                chatMessages.scrollTop = chatMessages.scrollHeight;
            });
            
            chatSocket.on('message', (message) => {
                renderMessage(message);
                chatMessages.scrollTop = chatMessages.scrollHeight;
            });

            chatSocket.on('error', (err) => {
                console.error('Socket Error:', err);
                showMessageBox('Chat Error', 'Connection lost or unauthorized chat access.', 'error');
            });

            chatSocket.on('disconnect', () => {
                console.log('Socket.IO disconnected.');
            });
        }


        /**
         * Renders a single message bubble into the chat window.
         */
        function renderMessage(message) {
            const messageElement = document.createElement('div');
            // Determine class: message.isAdmin is true if it comes from the admin user ID or the system
            const messageClass = message.isAdmin ? 'admin' : 'client';
            
            // Format timestamp
            const date = new Date(); // Use current time for simplicity, or message.timestamp if server sends full date
            const timeString = message.timestamp || date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            
            messageElement.classList.add('message', messageClass);
            messageElement.innerHTML = `
                <div class="message-bubble">${message.message}</div>
                <div class="message-info">${message.isAdmin  === 1? 'Support' : 'You'} • ${timeString}</div>
            `;
            chatMessages.appendChild(messageElement);
        }

        /**
         * Sends a new message to the server via socket.
         */
        function sendMessage() {
            const text = chatInput.value.trim();
            if (!text || !chatSocket || !chatSocket.connected) {
                showMessageBox('Chat Status', 'Cannot send: Chat is disconnected.', 'error');
                return;
            }

            chatSocket.emit('clientMessage', { message: text });
            chatInput.value = ''; 
            sendMessageButton.disabled = true; 
            
            // Re-enable button after a short delay to simulate network latency
            setTimeout(() => {
                 sendMessageButton.disabled = false;
            }, 500);
        }

        // Fetch messages is now just for initial load/manual refresh, history is managed by socket 'history' event
        function fetchMessages() {
             // If connected, the socket handles history automatically.
        }

        const confirmModal = document.getElementById('confirmModal');
const confirmTitle = document.getElementById('confirmTitle');
const confirmMessage = document.getElementById('confirmMessage');
const confirmOk = document.getElementById('confirmOk');
const confirmCancel = document.getElementById('confirmCancel');

function showConfirm({ title, message, onConfirm }) {
    confirmTitle.textContent = title || 'Confirm';
    confirmMessage.textContent = message || 'Are you sure?';

    confirmModal.classList.remove('hidden');

    const cleanup = () => {
        confirmModal.classList.add('hidden');
        confirmOk.onclick = null;
        confirmCancel.onclick = null;
    };

    confirmCancel.onclick = cleanup;

    confirmOk.onclick = async () => {
        await onConfirm();
        cleanup();
    };
}


        // --- Event Listeners and Initialization ---

        document.addEventListener('DOMContentLoaded', () => {
         
    const isAdmin = getItemWithExpiry('isAdmin');
    const userNav = document.getElementById('user-management-nav');
    const userPage = document.getElementById('user-management');


     const historyNav = document.getElementById('history-nav');
    const historyPage = document.getElementById('history');


       const walletNav = document.getElementById('wallet-nav');
    const walletPage = document.getElementById('wallet');

     const newInvestmentNav = document.getElementById('new-investment-nav');
    const newInvestmentPage = document.getElementById('new-investment');

    if (isAdmin|| isAdmin == 1) {
        userNav.classList.remove('hidden');
       
    } else {
        userNav.classList.add('hidden');
        historyNav.classList.remove('hidden');
        walletNav.classList.remove('hidden');
        newInvestmentNav.classList.remove('hidden');
    }

    if (!isAdmin || isAdmin == false) {
      



        // Optional: redirect to home if user tries to access manually
        if (window.location.hash === '#user-management') {
            window.location.hash = '#home';
            showPage('home'); // call your function to display default page
        }
    }
        
            // 1. Initial Authentication Check and Profile Load
            checkAuth();
            loadProfile();
            // Show admin links if user is admin
            
            // if (getItemWithExpiry('isAdmin')) {
                
            //     document.getElementById('user-management-nav').classList.remove('hidden');
               
            // }

            const navLinks = document.querySelectorAll('.sidebar nav a');
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetPageId = link.getAttribute('data-page');

            if (targetPageId === 'user-management' && (!isAdmin || isAdmin == false )) {
                
                showMessageBox('Access Denied', 'You do not have permission to access this page.', 'error');
                return;
            }

            showPage(targetPageId);

            // Update nav active state
            navLinks.forEach(nav => nav.classList.remove('active'));
            link.classList.add('active');
        });
    });

            

            const user = JSON.parse(localStorage.getItem('user'));
            if (user) {
                const balance = user.balance || 0;
                const tier = user.tier || 0;
                const profit = user.totalProfit;

                document.getElementById('total-balance').textContent = `$${balance.toFixed(2)}`;
                // document.getElementById('total-profit').textContent = `$${profit.toFixed(2)}`;

                const tierMap = {
                    0: { name: 'N/A', amount: 0 },
                    1: { name: 'Bronze Tier', amount: 2000 },
                    2: { name: 'Silver Tier', amount: 5000 },
                    3: { name: 'Gold Tier', amount: 10000 },
                    4: { name: 'Platinum Tier', amount: 25000 },
                    5: { name: 'Diamond Tier', amount: 50000 },
                    6: { name: 'Centurion Tier', amount: 100000 }
                };

                if (tier > 0 && tierMap[tier]) {
                    document.getElementById('active-investment').textContent = `$${tierMap[tier].amount.toFixed(2)}`;
                    document.getElementById('next-payout').textContent = tierMap[tier].name;
                }
            }

            // 2. Mobile Menu Toggle
            if (menuToggle && sidebar) {
        menuToggle.addEventListener('click', () => {
            sidebar.classList.toggle('active');
        });
    }

            // 3. Navigation/Page Switching Logic
            navLinks.forEach(link => {
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    
                    const targetPageId = link.getAttribute('data-page');

                    navLinks.forEach(nav => nav.classList.remove('active'));
                    link.classList.add('active');

                    pages.forEach(page => page.classList.add('hidden'));
                    const targetPage = document.getElementById(targetPageId);
                    if (targetPage) {
                        targetPage.classList.remove('hidden');
                        
                        // Special: If navigating to Chat, connect the socket
                        if (targetPageId === 'chat') {
                            connectChatSocket();
                        } else {
                            // Disconnect when navigating away from chat
                            if (chatSocket) {
                                chatSocket.disconnect();
                                chatSocket = null;
                            }
                        }
                    }

                    // Mobile Closing Logic
                  if (window.innerWidth <= 900 && sidebar.classList.contains('active')) {
    sidebar.classList.remove('active');
}
                });
            });
            
            // 4. Logout Handler
            logoutButton.addEventListener('click', (e) => {
                e.preventDefault();
                // Clear all auth data
                localStorage.clear();
                if (chatSocket) {
                    chatSocket.disconnect();
                }
                // window.location.href = 'checkout.html';
                window.location.href = 'login.html';
            });

            // 5. Profile Form Submission Handler
            if (profileForm) {
                profileForm.addEventListener('submit', async (e) => {
                    e.preventDefault(); 
                    saveProfileBtn.disabled = true;
                    saveProfileBtn.textContent = 'Saving...';
                    
                    const token = checkAuth();
                    if (!token) return;
                    
                    const newName = nameInput.value.trim();
                    const newAddress = addressInput.value.trim();
                    const newPassword = newPasswordInput.value.trim();
                    
                    if (newPassword && newPassword.length < 8) {
                        showMessageBox('Error', 'New password must be at least 8 characters.', 'error');
                        saveProfileBtn.disabled = false;
                        saveProfileBtn.textContent = 'Save Changes';
                        return;
                    }

                    try {
                        // FIXED: Template literal backticks added here
                        const response = await fetch(`${API_BASE_URL}/profile/update`, {
                            method: 'POST',
                            headers: getAuthHeaders(token),
                            body: JSON.stringify({
                                name: newName,
                                address: newAddress,
                                newPassword: newPassword || undefined
                            }),
                        });

                        const data = await response.json();
                        
                        if (response.ok) {
                            // Update UI immediately
                            const newInitials = data.name.match(/\b(\w)/g).join('').toUpperCase().substring(0, 2);
                            updateUI(data.name, newInitials, localStorage.getItem('clientId'));
                            newPasswordInput.value = ''; // Clear password field after success
                            showMessageBox('Success', 'Profile changes saved successfully.', 'success');
                        } else {
                             showMessageBox('Error', data.message || 'Failed to update profile.', 'error');
                        }
                        
                    } catch (error) {
                        console.error('Error updating profile:', error);
                        showMessageBox('Network Error', 'Could not communicate with the server to save changes.', 'error');
                    } finally {
                        saveProfileBtn.disabled = false;
                        saveProfileBtn.textContent = 'Save Changes';
                    }
                });
            }
            
            // 6. Chat Message Sending Handlers
            if (sendMessageButton) {
                sendMessageButton.addEventListener('click', sendMessage);
                chatInput.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault(); // Prevent form submission if input is wrapped in form
                        sendMessage();
                    }
                });
            }

            // --- Admin User Management ---
            const userManagementPage = document.getElementById('user-management');
            if (userManagementPage) {
                const addUserBtn = document.getElementById('add-user-btn');
                const addUserModal = document.getElementById('add-user-modal');
                const editUserModal = document.getElementById('edit-user-modal');
                const addUserForm = document.getElementById('add-user-form');
                const editUserForm = document.getElementById('edit-user-form');
                const userTableBody = document.getElementById('user-table-body');
                const closeButtons = document.querySelectorAll('.close-button');

                async function fetchUsers() {
                    const token = getItemWithExpiry('userToken');
                    const response = await fetch('/api/v1/users', {
                        headers: getAuthHeaders(token)
                    });

                     const loggedInUser = JSON.parse(localStorage.getItem('user')); // get current user
    const loggedInUserId = loggedInUser ? loggedInUser.id : null;
                    const data = await response.json();
                    
                    if (data.success) {
                            const tierMap = {
                            0: 'N/A',
                            1: 'Bronze Tier',
                            2: 'Silver Tier',
                            3: 'Gold Tier',
                            4: 'Platinum Tier',
                            5: 'Diamond Tier',
                            6: 'Centurion Tier'
                            };
                        userTableBody.innerHTML = '';
                        data?.users?.filter(user => user?.id !== loggedInUserId).forEach(user => {
                            const tierName = tierMap[user.tier] || 'N/A';
                            const row = document.createElement('tr');
                            row.innerHTML = `
                                <td>${user.name}</td>
                                <td>${user.email}</td>
                                <td>${formatCurrency(user.balance)}</td>
                                <td>${tierName}</td>
                                <td>
                                    <button class="edit-btn" data-id="${user.id}">Edit</button>
                                    <button class="delete-btn" data-id="${user.id}">Delete</button>
                                </td>
                            `;
                            userTableBody.appendChild(row);
                        });
                    }
                }

                addUserBtn.addEventListener('click', () => {
                    addUserModal.style.display = 'block';
                });

                closeButtons.forEach(btn => {
                    btn.addEventListener('click', () => {
                        addUserModal.style.display = 'none';
                        editUserModal.style.display = 'none';
                    });
                });

                addUserForm.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const token = getItemWithExpiry('userToken');
                    const name = document.getElementById('add-name').value;
                    const email = document.getElementById('add-email').value;
                    const password = document.getElementById('add-password').value;
                    const response = await fetch('/api/v1/users', {
                        method: 'POST',
                        headers: getAuthHeaders(token),
                        body: JSON.stringify({ name, email, password })
                    });
                    const data = await response.json();
                    if (data.success) {
                        
                        addUserModal.style.display = 'none';

            // ✅ Clear all inputs
            addUserForm.reset();
                        fetchUsers();
                    } else {
                        
                        showMessageBox('Error', data.message || 'Failed to add user.', 'error');
                    }
                });

                userTableBody.addEventListener('click', async (e) => {
                    const token = getItemWithExpiry('userToken');
                if (e.target.classList.contains('delete-btn')) {
        const id = e.target.dataset.id;

        // Show confirmation modal before deletion
        showConfirm({
            title: 'Delete User',
            message: 'Are you sure you want to delete this user?',
            onConfirm: async () => {
                try {
                    const response = await fetch(`/api/v1/users/${id}`, {
                        method: 'DELETE',
                        headers: getAuthHeaders(token)
                    });
                    const data = await response.json();

                    if (data.success) {
                        showMessageBox('Success', 'User deleted successfully.', 'success');
                        fetchUsers(); // Refresh user table
                    } else {
                        showMessageBox('Error', data.message || 'Failed to delete user.', 'error');
                    }
                } catch (err) {
                    console.error('Deletion error:', err);
                    showMessageBox('Error', 'Network error: could not delete user.', 'error');
                }
            }
        });
    } else if (e.target.classList.contains('edit-btn')) {
                        const row = e.target.closest('tr');
                        const id = e.target.dataset.id;
                        const name = row.cells[0].textContent;
                        const email = row.cells[1].textContent;
                        const balance = row.cells[2].textContent;
                        const tier = row.cells[3].textContent;

                        document.getElementById('edit-user-id').value = id;
                        document.getElementById('edit-name').value = name;
                        document.getElementById('edit-email').value = email;
                        document.getElementById('edit-balance').value = balance;
                        document.getElementById('edit-tier').value = tier;
                        editUserModal.style.display = 'block';
                    }
                });

                editUserForm.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const token = getItemWithExpiry('userToken');
                    const id = document.getElementById('edit-user-id').value;
                    const name = document.getElementById('edit-name').value;
                    const email = document.getElementById('edit-email').value;
                    const balance = document.getElementById('edit-balance').value;
                    const tier = document.getElementById('edit-tier').value;
                    await fetch(`/api/v1/users/${id}`, {
                        method: 'PUT',
                        headers: getAuthHeaders(token),
                        body: JSON.stringify({ name, email, balance, tier })
                    });
                    editUserModal.style.display = 'none';
                    fetchUsers();
                });

                if (getItemWithExpiry('isAdmin')) {
                    fetchUsers();
                }
            }
            
            // Ensure the initial page is displayed correctly (Home)
            const initialPageLink = document.querySelector('.sidebar nav a.active');
            if (initialPageLink) {
                 const initialPageId = initialPageLink.getAttribute('data-page');
                 document.getElementById(initialPageId).classList.remove('hidden');
            }
        });
