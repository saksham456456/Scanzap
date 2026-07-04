const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');
const Razorpay = require('razorpay');

admin.initializeApp();

// Configuration for Razorpay.
// We expect RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to be available in process.env
// or set via firebase config. Using process.env for standard Node.js deployment,
// but firebase-functions config or Google Cloud Secret Manager is recommended for prod.
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_test_YOUR_KEY_HERE';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'YOUR_SECRET_HERE';
const PLAN_DAYS = 30;

const razorpay = new Razorpay({
  key_id: RAZORPAY_KEY_ID,
  key_secret: RAZORPAY_KEY_SECRET,
});

const PLAN_AMOUNT = 9900; // Hardcoded plan amount in paise (₹99)

exports.createRazorpayOrder = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be logged in to create an order.');
  }

  try {
    const options = {
      amount: PLAN_AMOUNT,
      currency: "INR",
      receipt: `receipt_${context.auth.uid}_${Date.now()}`
    };

    const order = await razorpay.orders.create(options);
    return {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency
    };
  } catch (error) {
    console.error('Error creating Razorpay order:', error);
    throw new functions.https.HttpsError('internal', 'Failed to create Razorpay order.');
  }
});

exports.verifyRazorpayPayment = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be logged in to verify a payment.');
  }

  const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = data;

  if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing Razorpay payment parameters.');
  }

  // 1. Verify the signature
  const generatedSignature = crypto
    .createHmac('sha256', RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  if (generatedSignature !== razorpay_signature) {
    console.error('Razorpay signature mismatch.');
    throw new functions.https.HttpsError('permission-denied', 'Invalid payment signature.');
  }

  // 2. Grant Pro status if signature is valid
  try {
    const uid = context.auth.uid;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + PLAN_DAYS);

    await admin.firestore().collection('users').doc(uid).set({
      isPro: true,
      proExpiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
      lastPaymentId: razorpay_payment_id,
      lastOrderId: razorpay_order_id,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    return { success: true };
  } catch (error) {
    console.error('Error updating user Pro status:', error);
    throw new functions.https.HttpsError('internal', 'Payment verified but failed to update user status.');
  }
});
