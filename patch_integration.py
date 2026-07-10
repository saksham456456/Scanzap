import re

with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add firebase functions script
funcs_script = '<script src="https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore-compat.js"></script>\n<script src="https://www.gstatic.com/firebasejs/9.22.0/firebase-functions-compat.js"></script>'
content = content.replace('<script src="https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore-compat.js"></script>', funcs_script)

# 2. Update buyPack to call functions for testing
buy_pack_search = """    handler: async function (response) {
      // In prod, verify signature via Cloud Function.
      // Here, we'll write directly for the frontend demo requirement.
      const pId = response.razorpay_payment_id;

      const userRef = db.collection('users').doc(user.uid);
      const purchaseRef = userRef.collection('purchases').doc();

      await purchaseRef.set({
        pack: packId,
        credits: packCredits,
        amount: amountPaise,
        razorpayPaymentId: pId,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      await userRef.update({
        credits: firebase.firestore.FieldValue.increment(packCredits),
        creditsEarned: firebase.firestore.FieldValue.increment(packCredits)
      });

      toast('🎉 Payment successful! Added ' + packCredits + ' credits.', 'credit');
    },"""

buy_pack_replace = """    handler: async function (response) {
      // Test Integration: Calling backend to verify payment and issue credits.
      const pId = response.razorpay_payment_id;

      try {
        toast('Verifying payment...', 'ok');
        const verifyFn = firebase.functions().httpsCallable('verifyCreditPayment');
        await verifyFn({
          packId: packId,
          razorpay_payment_id: pId,
          razorpay_order_id: 'test_order_id_frontend',
          razorpay_signature: 'test_sig',
          bypassTest: true // Since we are integrating for testing without real keys
        });
        toast('🎉 Payment successful! Added ' + packCredits + ' credits.', 'credit');
      } catch(e) {
        toast('Backend Verification Failed: ' + e.message, 'err');
      }
    },"""

content = content.replace(buy_pack_search, buy_pack_replace)

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("Integration patched")
