const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');
const Razorpay = require('razorpay');

admin.initializeApp();

// Razorpay config
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_test_YOUR_KEY_HERE';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'YOUR_SECRET_HERE';

const razorpay = new Razorpay({
  key_id: RAZORPAY_KEY_ID,
  key_secret: RAZORPAY_KEY_SECRET,
});

// Pack definitions (Source of truth)
const PACKS = {
  starter: { credits: 25, amount: 999 },
  creator: { credits: 80, amount: 2499 },
  studio:  { credits: 200, amount: 4999 },
  agency:  { credits: 600, amount: 9999 }
};

exports.createCreditOrder = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be logged in.');
  }

  const { packId } = data;
  const pack = PACKS[packId];
  if (!pack) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid pack selected.');
  }

  try {
    const options = {
      amount: pack.amount,
      currency: "USD",
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

exports.verifyCreditPayment = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be logged in.');
  }

  const { packId, razorpay_payment_id, razorpay_order_id, razorpay_signature } = data;
  const pack = PACKS[packId];

  if (!pack || !razorpay_payment_id || !razorpay_order_id) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing parameters.');
  }

  // 1. Verify the signature (unless bypassing in test environment)
  const isTestMode = process.env.TEST_MODE === 'true';
  if (isTestMode) {
    console.log("Bypassing signature validation for testing.");
  } else {
    if (!razorpay_signature) throw new functions.https.HttpsError('invalid-argument', 'Missing signature.');
    const generatedSignature = crypto
      .createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (generatedSignature !== razorpay_signature) {
      console.error('Razorpay signature mismatch.');
      throw new functions.https.HttpsError('permission-denied', 'Invalid payment signature.');
    }
  }

  // 2. Grant Credits
  try {
    const uid = context.auth.uid;
    const userRef = admin.firestore().collection('users').doc(uid);

    // Check for replay attacks
    const existingPurchase = await userRef.collection('purchases')
      .where('razorpayPaymentId', '==', razorpay_payment_id)
      .limit(1)
      .get();

    if (!existingPurchase.empty) {
      console.error('Replay attack detected. Payment ID already processed.');
      throw new functions.https.HttpsError('already-exists', 'Payment already processed.');
    }

    const purchaseRef = userRef.collection('purchases').doc();

    const batch = admin.firestore().batch();

    // Record purchase
    batch.set(purchaseRef, {
      pack: packId,
      credits: pack.credits,
      amount: pack.amount,
      razorpayPaymentId: razorpay_payment_id,
      razorpayOrderId: razorpay_order_id,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Update user credits
    batch.update(userRef, {
      credits: admin.firestore.FieldValue.increment(pack.credits),
      creditsEarned: admin.firestore.FieldValue.increment(pack.credits)
    });

    await batch.commit();

    return { success: true, addedCredits: pack.credits };
  } catch (error) {
    console.error('Error updating user credits:', error);
    throw new functions.https.HttpsError('internal', 'Payment verified but failed to update user credits.');
  }
});
