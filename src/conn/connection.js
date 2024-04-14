const admin = require('firebase-admin');
var serviceAccount = require('./admin.json');
//Firebase
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
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