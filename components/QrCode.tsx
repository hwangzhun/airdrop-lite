import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export const QrCode: React.FC<{ value: string }> = ({ value }) => {
  const [source, setSource] = useState('');
  useEffect(() => {
    let active = true;
    void QRCode.toDataURL(value, { width: 360, margin: 1, errorCorrectionLevel: 'M' })
      .then(url => { if (active) setSource(url); });
    return () => { active = false; };
  }, [value]);
  return source ? <img className="qr" src={source} alt="接收链接二维码" /> : null;
};
