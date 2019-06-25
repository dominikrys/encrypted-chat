/*
* app.js - handles serverside
*/

const express = require('express')

// Setup Express server
const app = express()
const http = require('http').Server(app)

// Attach Socket.io to server
const io = require('socket.io')(http)

// Serve web app directory
app.use(express.static('public'))

// Map holding all keys and their nicknames
var nicknameMap = new Map()

/** Manage behavior of each client socket connection */
io.on('connection', (socket) => {
    console.log(`User Connected - Socket ID ${socket.id}`)

    // Store the room that the socket is connected to
    let currentRoom = null

    /** Process a room join request. */
    socket.on('JOIN', (roomName) => {
        // Get chatroom info
        let room = io.sockets.adapter.rooms[roomName]

        // Reject join request if room already has more than 1 connection
        if (room && room.length > 1) {
            // Notify user that their join request was rejected
            io.to(socket.id).emit('ROOM_FULL', null)

            // Notify room that someone tried to join
            socket.broadcast.to(roomName).emit('INTRUSION_ATTEMPT', null)
        } else {
            // Leave current room
            socket.leave(currentRoom)

            // Notify room that user has left
            socket.broadcast.to(currentRoom).emit('USER_DISCONNECTED', null)

            // Join new room
            currentRoom = roomName
            socket.join(currentRoom)

            // Notify user of room join success
            io.to(socket.id).emit('ROOM_JOINED', currentRoom)

            // Notify room that user has joined
            socket.broadcast.to(currentRoom).emit('NEW_CONNECTION', null)
        }
    })

    /** Broadcast a received message to the room */
    socket.on('MESSAGE', (msg) => {
        console.log(`New Message - ${msg.text}`)
        socket.broadcast.to(currentRoom).emit('MESSAGE', msg)
    })

    /** Broadcast a new publickey to the room */
    socket.on('PUBLIC_KEY', (key) => {
        socket.broadcast.to(currentRoom).emit('PUBLIC_KEY', key)
    })

    /** Rename client */
    socket.on('SET_NAME', (nicknameArray) => {
        // Remove the key's current nickname if already in the nickname map
        if (nicknameMap.has(nicknameArray[0])) {
            nicknameMap.delete(nicknameArray[0])
        }

        // Set new nickname
        nicknameMap.set(nicknameArray[0], nicknameArray[1])
    })

    /** Broadcast a disconnection notification to the room */
    socket.on('disconnect', () => {
        socket.broadcast.to(currentRoom).emit('USER_DISCONNECTED', null)
    })
})

// Start server
const port = process.env.PORT || 3000
http.listen(port, () => {
    console.log(`Chat server listening on port ${port}.`)
})