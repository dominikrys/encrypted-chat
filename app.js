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

// Maximum amount of users in chat rooms
var userLimit = 32

// Map holding various sockets and the public key that has been generated for them
var socketMap = new Map()

/** Manage behavior of each client socket connection */
io.on('connection', (socket) => {
    console.log(`User connected - socket ID: ${socket.id}`)

    // Store the room that the socket is connected to
    let currentRoom = null

    /** Process a room join request. */
    socket.on('JOIN', (roomName) => {
        // Get chatroom info
        let room = io.sockets.adapter.rooms[roomName]

        // Reject join request if room already has more than 1 connection
        if (room && room.length > userLimit - 1) {
            // Notify user that their join request was rejected
            io.to(socket.id).emit('ROOM_FULL', userLimit)

            // Notify room that someone tried to join over user limit
            socket.broadcast.to(roomName).emit('MAX_USERS_REACHED', userLimit)
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
        console.log(`Message sent on socket: ${socket.id}`)
        socket.broadcast.to(currentRoom).emit('MESSAGE', msg)
    })

    /** Broadcast a new publickey to the room */
    socket.on('PUBLIC_KEY', (keyName) => {
        // Associate this public key with the socket if not there already
        if (!socketMap.has(socket.id)) {
            socketMap.set(socket.id, keyName[0])
        }

        // Broadcast public key to room
        socket.broadcast.to(currentRoom).emit('PUBLIC_KEY', keyName)
    })

    /** Broadcast a disconnection notification to the room */
    socket.on('disconnect', () => {
        // Add noitification
        console.log(`User disconnected - socket ID: ${socket.id}`)

        // Get public key of disconnected user and send to current room
        socket.broadcast.to(currentRoom).emit('USER_DISCONNECTED', socketMap.get(socket.id))

        // Remove socket from socketMap as it's not needed any more
        socketMap.delete(socket.id)
    })
})

// Start server
const port = process.env.PORT || 3000
http.listen(port, () => {
    console.log(`Chat server listening on port ${port}.`)
})
