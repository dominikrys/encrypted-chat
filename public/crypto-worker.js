self.window = self // This is required for the jsencrypt library to work within the webworker

// Import the jsencrypt library
self.importScripts('https://cdnjs.cloudflare.com/ajax/libs/jsencrypt/2.3.1/jsencrypt.min.js');

let cryptInstance = null
let privateKey = null

/** Webworker onmessage listener */
onmessage = function(e) {
    const [ messageType, messageId, text, key ] = e.data
    let result
    switch (messageType) {
        case 'generate-keys':
        result = generateKeypair()
        break
        case 'encrypt':
        result = encrypt(text, key)
        break
        case 'decrypt':
        result = decrypt(text)
        break
    }

    // Return result to the UI thread
    postMessage([ messageId, result ])
}

/** Generate and store keypair */
function generateKeypair () {
    cryptInstance = new JSEncrypt({default_key_size: 2056})
    privateKey = cryptInstance.getPrivateKey()

    // Only return the public key, keep the private key hidden
    return cryptInstance.getPublicKey()
}

/** Encrypt the provided string with the destination public key */
function encrypt (content, publicKey) {
    cryptInstance.setKey(publicKey)
    return cryptInstance.encrypt(content)
}

/** Decrypt the provided string with the local private key */
function decrypt (content) {
    cryptInstance.setKey(privateKey)
    return cryptInstance.decrypt(content)
}
