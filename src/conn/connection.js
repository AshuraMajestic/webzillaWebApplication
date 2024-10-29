const admin = require('firebase-admin');

admin.initializeApp({
    credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    }),
    databaseURL: process.env.databaseURL,
    authDomain: process.env.authDomain,
});
var db = admin.database();
var userRef = db.ref("UserData");
const shopRef = db.ref("Shops");
const visitorRef = db.ref("VisitorCounts");

module.exports = {
    userRef: userRef,
    shopRef: shopRef,
    visitorRef: visitorRef
};