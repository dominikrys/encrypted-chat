// Configure Express
var express = require('express');
var app = express();
var server = require('http').createServer(app);
var io = require('socket.io').listen(server);
var path = require('path');
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');

// Get server to listen to connections
server.listen(process.env.PORT || 3000, function() {
    console.log('Server listening');
});

// Routes - route from root
app.get("/", function(req, res) {
    res.render("chat.ejs");
});

// Configure web sockets.
io.sockets.on("connection", function(socket) {
    socket.on("chat-message", function(message) {
        io.sockets.emit("chat-message", message);
    });
});
