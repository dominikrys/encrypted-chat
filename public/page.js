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
            destinationPublicKey: null,
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

                // Clear stored names when room joined and set sender's nickname
                this.nicknameMap = new Map()
                this.nicknameMap.set(this.originPublicKey, this.nickname)
            })

            // Save public key and name when received
            this.socket.on('PUBLIC_KEY', (key) => {
                // Check if user already in nicknameMap
                if (this.nicknameMap.has(key[0])){
                    this.addNotification(`${this.nicknameMap.get(key[0])} has changed their name to ${key[1]}`)
                } else {
                    this.addNotification(`Public Key Received - ${this.getKeySnippet(key[0])}`)
                    this.destinationPublicKey = key[0]
                }

                // Update user's name
                this.nicknameMap.set(key[0], key[1])
            })

            // Clear destination public key if other user leaves room
            this.socket.on('user disconnected', () => {
                this.notify(`User Disconnected - ${this.getKeySnippet(this.destinationKey)}`)
                this.destinationPublicKey = null
            })

            // Notify user that the room they are attempting to join is full
            this.socket.on('ROOM_FULL', () => {
                this.addNotification(`Cannot join ${this.pendingRoom}, room is full`)

                // Join a random room as a fallback
                this.pendingRoom = Math.floor(Math.random() * 1000)
                this.joinRoom()
            })

            // Notify room that someone attempted to join
            this.socket.on('INTRUSION_ATTEMPT', () => {
                this.addNotification('A third user attempted to join the room.')
            })
        },

        /** Encrypt and emit the current draft message */
        async sendMessage() {
            // Don't send message if there is nothing to send
            if (!this.draft || this.draft === '') { return }

            // Use immutable.js to avoid unintended side-effects.
            let message = Immutable.Map({
                text: this.draft,
                recipient: this.destinationPublicKey,
                sender: this.originPublicKey,
                senderNickname: this.nickname,
                time: new Date().toLocaleTimeString()
            })

            // Reset the UI input draft text
            this.draft = ''

            // Instantly add (unencrypted) message to local UI
            this.addMessage(message.toObject())

            if (this.destinationPublicKey) {
                // Encrypt message with the public key of the other user
                const encryptedText = await this.getWebWorkerResponse(
                    'encrypt', [ message.get('text'), this.destinationPublicKey ])
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
                    this.destinationPublicKey = null

                    // Emit room join request.
                    this.socket.emit('JOIN', this.pendingRoom)
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
                this.notifications.push({ message, timestamp })
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
                    const handler = function (e) {
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

            /** Change user's nickname */
            changeNickname() {
                // Check if nickname actually changed
                if (this.nickname != this.nicknameMap.get(this.originPublicKey)) {
                    // Send public key with nickname again and add notification
                    this.addNotification(`Nickname changed from ${this.nicknameMap.get(this.originPublicKey)} to ${this.nickname}`)
                    this.sendPublicKey()
                }
            },

            /** Emit the public key with name to all users in the chatroom */
            sendPublicKey() {
                if (this.originPublicKey) {
                    this.socket.emit('PUBLIC_KEY', [this.originPublicKey, this.nickname])
                }
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
                if (element) { element.scrollTop = element.scrollHeight }
            }
        }
    })
