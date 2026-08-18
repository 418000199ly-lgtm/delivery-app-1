const fs = require('fs');

const dFile = fs.readFileSync('src/components/MobileDispatchValetOrder.tsx', 'utf8');

const targetStr = `  // Real-time listener for current dispatcher's WeChat QR code from Firestore
  useEffect(() => {
    if (!activePhone) {
      setWechatQrUrl('');
      return;
    }
    const userKey = \`dd_dispatch_wechat_qr_\${activePhone}\`;
    const localSaved = localStorage.getItem(userKey);
    if (localSaved) {
      setWechatQrUrl(localSaved);
    } else {
      setWechatQrUrl(''); // Reset if none exists for this user
    }

    if (db) {
      const unsub = onSnapshot(doc(db, 'dispatch_qrs', activePhone), (snap) => {
        if (snap.exists() && snap.data()?.qrCode) {
          const remoteQr = snap.data().qrCode;
          setWechatQrUrl(remoteQr);
          localStorage.setItem(userKey, remoteQr);
        }
      });
      return () => unsub();
    }
  }, [activePhone]);`;

const newFile = dFile.replace(targetStr + "\n\n", "");

const activePhoneStr = `  const activePhone = isDispatchLoggedIn && loginPhone ? loginPhone : (userPhone || '');`;

const finalFile = newFile.replace(activePhoneStr, activePhoneStr + "\n\n" + targetStr);

fs.writeFileSync('src/components/MobileDispatchValetOrder.tsx', finalFile);
console.log("Moved useEffect below activePhone");
