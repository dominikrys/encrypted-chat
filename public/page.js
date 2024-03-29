/*
* page.js - handles clientside
*/

/** The core Vue instance controlling the UI */
const vm = new Vue({
    el: '#vue-instance',
    data() {
        return {
            cryptWorker: null,
            socket: null,
            originPublicKey: null,
            destinationPublicKeys: [],
            messages: [],
            notifications: [],
            currentRoom: null,
            pendingRoom: Math.floor(Math.random() * 1000),
            draft: '',
            nickname: null,
            nicknameMap: null
        }
    },
    async created() {
        this.addNotification('Welcome! Generating a new keypair now.')

        // Initialize crypto webworker thread
        this.cryptWorker = new Worker('crypto-worker.js')

        // Generate keypair and join default room
        this.originPublicKey = await this.getWebWorkerResponse('generate-keys')
        this.addNotification(`Keypair Generated - ${this.getKeySnippet(this.originPublicKey)}`)

        // Set default nickname from key snippet and add it to the nicknameMap
        this.nickname = this.getKeySnippet(this.originPublicKey);
        this.nicknameMap = new Map()
        this.nicknameMap.set(this.originPublicKey, this.nickname)

        // Initialize socketio
        this.socket = io()
        this.setupSocketListeners()
    },
    methods: {
        /** Setup Socket.io event listeners */
        setupSocketListeners() {
            // Automatically join default room on connect
            this.socket.on('connect', () => {
                this.addNotification('Connected To Server.')
                this.joinRoom()
            })

            // Notify user that they have lost the socket connection
            this.socket.on('disconnect', () => this.addNotification('Lost Connection'))

            // Decrypt and display message when received
            this.socket.on('MESSAGE', async (message) => {
                // Only decrypt messages that were encrypted with the user's public key
                if (message.recipient === this.originPublicKey) {
                    // Decrypt the message text in the webworker thread
                    message.text = await this.getWebWorkerResponse('decrypt', message.text)

                    // Fill in message sender - obtained from local map so can't be spoofed
                    message.senderNickname = this.nicknameMap.get(message.sender)

                    // Update message with newest received timestamp
                    message.time = new Date().toLocaleTimeString()

                    // Push message to message array
                    this.messages.push(message)
                }
            })

            // When a user joins the current room, send them your public key
            this.socket.on('NEW_CONNECTION', () => {
                this.addNotification('Another user joined the room.')
                this.sendPublicKey()
            })

            // Broadcast public key when a new room is joined
            this.socket.on('ROOM_JOINED', (newRoom) => {
                this.currentRoom = newRoom
                this.addNotification(`Joined Room - ${this.currentRoom}`)
                this.sendPublicKey()

                // Clear stored names and keys when room joined and set sender's nickname
                this.nicknameMap = new Map()
                this.nicknameMap.set(this.originPublicKey, this.nickname)
                this.destinationPublicKeys = []
            })

            // Save public key and name when received
            this.socket.on('PUBLIC_KEY', (keyName) => {
                // Check if user already in nicknameMap
                if (this.nicknameMap.has(keyName[0])) {
                    // Check if the user has actually changed their name
                    if (this.nicknameMap.get(keyName[0]) != keyName[1]) {
                        // Already in nicknameMap, add notification saying name change
                        this.addNotification(`${this.nicknameMap.get(keyName[0])} has changed their name to ${keyName[1]}`)
                    }
                } else {
                    // New public key, add notification and put key into destination array
                    this.addNotification(`Public Key Received - ${this.getKeySnippet(keyName[0])}`)
                    this.destinationPublicKeys.push(keyName[0])
                }

                // Update user's name
                this.nicknameMap.set(keyName[0], keyName[1])
            })

            // Clear destination public key if other user leaves room
            this.socket.on('USER_DISCONNECTED', (key) => {
                // Add notification that user disconnected
                this.addNotification(`User disconnected: ${this.nicknameMap.get(key)} [${this.getKeySnippet(key)}]`)

                // Find the disconethis.destinationPublicKeys.indexOf(key)ncted user's public key in the public key list and remove it
                var index = this.destinationPublicKeys.indexOf(key)

                if (index > -1) {
                    this.destinationPublicKeys.splice(index, 1)
                }
            })

            // Notify user that the room they are attempting to join is full
            this.socket.on('ROOM_FULL', (limit) => {
                this.addNotification(`Cannot join ${this.pendingRoom}, room is full. Max capacity: ${limit}`)

                // Join a random room as a fallback
                this.pendingRoom = Math.floor(Math.random() * 1000)
                this.joinRoom()
            })

            // Notify room that someone attempted to join over max user limit
            this.socket.on('MAX_USERS_REACHED', (limit) => {
                this.addNotification(`Another user tried joining however the room has reached max capacity of: ${limit}`)
            })
        },

        /** Encrypt and emit the current draft message */
        async sendMessage() {
            // Don't send message if there is nothing to send
            if (!this.draft || this.draft === '') {
                return
            }

            // Use immutable.js to avoid unintended side-effects.
            let message = Immutable.Map({
                text: this.draft,
                recipient: null,
                sender: this.originPublicKey,
                senderNickname: this.nickname,
                time: new Date().toLocaleTimeString()
            })

            // Reset the UI input draft text
            this.draft = ''

            // Instantly add (unencrypted) message to local UI
            this.addMessage(message.toObject())

            // Loop through every destination, encrypting the message separately
            for (var  i = 0; i < this.destinationPublicKeys.length; i++) {
                const encryptedText = await this.getWebWorkerResponse(
                    'encrypt', [message.get('text'), this.destinationPublicKeys[i]])

                    // Set message recipient
                    message = message.set('recipient', this.destinationPublicKeys[i])

                    // Set encrypted text in message
                    const encryptedMsg = message.set('text', encryptedText)

                    // Emit the encrypted message
                    this.socket.emit('MESSAGE', encryptedMsg.toObject())
                }
            },

            /** Join the specified chatroom */
            joinRoom() {
                if (this.pendingRoom !== this.currentRoom && this.originPublicKey) {
                    this.addNotification(`Connecting to Room - ${this.pendingRoom}`)

                    // Reset room state variables
                    this.messages = []
                    this.destinationPublicKeys = []

                    // Emit room join request.
                    this.socket.emit('JOIN', this.pendingRoom)
                }
            },

            /** Emit the public key with name to all users in the chatroom */
            sendPublicKey() {
                if (this.originPublicKey) {
                    this.socket.emit('PUBLIC_KEY', [this.originPublicKey, this.nickname])
                }
            },

            /** Change user's nickname */
            changeNickname() {
                // Check if nickname actually changed
                if (this.nickname != this.nicknameMap.get(this.originPublicKey)) {
                    // Send public key with nickname again and add notification
                    this.addNotification(`Nickname changed from ${this.nicknameMap.get(this.originPublicKey)} to ${this.nickname}`)
                    this.sendPublicKey()
                }
            },

            /** Add message to UI, and scroll the view to display the new message. */
            addMessage(message) {
                this.messages.push(message)
                this.autoscroll(this.$refs.chatContainer)
            },

            /** Append a notification message in the UI */
            addNotification(message) {
                const timestamp = new Date().toLocaleTimeString()
                this.notifications.push({
                    message,
                    timestamp
                })
                this.autoscroll(this.$refs.notificationContainer)
            },

            /** Post a message to the webworker, and return a promise that will resolve with the response.  */
            getWebWorkerResponse(messageType, messagePayload) {
                return new Promise((resolve, reject) => {
                    // Generate a random message id to identify the corresponding event callback
                    const messageId = Math.floor(Math.random() * 100000)

                    // Post the message to the webworker
                    this.cryptWorker.postMessage([messageType, messageId].concat(messagePayload))

                    // Create a handler for the webworker message event
                    const handler = function(e) {
                        // Only handle messages with the matching message id
                        if (e.data[0] === messageId) {
                            // Remove the event listener once the listener has been called.
                            e.currentTarget.removeEventListener(e.type, handler)

                            // Resolve the promise with the message payload.
                            resolve(e.data[1])
                        }
                    }

                    // Assign the handler to the webworker 'message' event.
                    this.cryptWorker.addEventListener('message', handler)
                })
            },

            /** Get key snippet for display purposes */
            getKeySnippet(key) {
                return key.slice(400, 416)
            },

            /** Get shorter key snippet for display purposes */
            getShortKeySnippet(key) {
                return key.slice(400, 405)
            },

            /** Autoscoll DOM element to bottom */
            autoscroll(element) {
                if (element) {
                    element.scrollTop = element.scrollHeight
                }
            }
        }
    })
