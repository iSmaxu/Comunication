import React, { useState, useEffect } from 'react';
import { api } from '../services/api/client.js';
import { useAppStore } from '../stores/appStore.js';

export default function HandshakeModal({ onClose }: { onClose: () => void }) {
  const user = useAppStore(s => s.user);
  const loadConversations = useAppStore(s => s.loadConversations);

  const [activeTab, setActiveTab] = useState<'invite' | 'pending'>('invite');
  const [targetCode, setTargetCode] = useState('');
  const [status, setStatus] = useState('');
  
  const [pendingList, setPendingList] = useState<any[]>([]);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [confirmPin, setConfirmPin] = useState('');

  useEffect(() => {
    if (activeTab === 'pending') {
       loadPending();
    }
  }, [activeTab]);

  const loadPending = async () => {
    try {
      const resp = await api.getPendingHandshakes();
      setPendingList(resp.data || []);
    } catch(err: any) {
      console.error(err);
    }
  };

  const handleSendRequest = async () => {
    if(!targetCode.trim()) return;
    setStatus('Enviando...');
    try {
      await api.sendHandshakeRequest(targetCode.trim());
      setStatus('¡Solicitud enviada!');
      setTargetCode('');
    } catch(err: any) {
      setStatus(`Error: ${err.message}`);
    }
  };

  const handleAccept = async (reqId: string) => {
    if(!confirmPin.trim()) return;
    try {
      await api.acceptHandshake(reqId, confirmPin.trim());
      await loadConversations();
      onClose();
    } catch(err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ padding: '24px', maxWidth: '400px', width: '90%', borderRadius: '16px', background: 'var(--color-bg-elevated)', border: '1px solid var(--color-divider)', boxShadow: '0 10px 40px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px', alignItems: 'center' }}>
          <h2 style={{ fontSize: '18px', margin: 0, fontWeight: 600 }}>Añadir Contacto</h2>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '18px' }}>✖</button>
        </div>

        <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
          <button onClick={() => setActiveTab('invite')} className={activeTab === 'invite' ? 'btn-primary' : 'btn-secondary'} style={{ flex: 1, padding: '10px' }}>Conectar</button>
          <button onClick={() => setActiveTab('pending')} className={activeTab === 'pending' ? 'btn-primary' : 'btn-secondary'} style={{ flex: 1, padding: '10px' }}>Solicitudes ({pendingList.length > 0 ? pendingList.length : '0'})</button>
        </div>

        {activeTab === 'invite' && (
          <div style={{ animation: 'fadeIn 0.2s ease-out' }}>
            <div style={{ background: 'rgba(0,0,0,0.2)', padding: '15px', borderRadius: '10px', marginBottom: '20px', textAlign: 'center', border: '1px dashed var(--color-divider)' }}>
              <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', margin: '0 0 8px 0' }}>Tu código para recibir solicitudes es:</p>
              <div style={{ fontSize: '24px', color: 'var(--color-accent)', letterSpacing: '4px', fontWeight: 700 }}>{user?.publicCode || '-----'}</div>
            </div>

            <div>
              <label style={{ fontSize: '13px', color: 'var(--color-text-muted)', fontWeight: 500 }}>Enviar solicitud a código ajeno:</label>
              <input 
                 value={targetCode} 
                 onChange={e => setTargetCode(e.target.value.toUpperCase())} 
                 className="form-input" 
                 placeholder="Ej. B5GH8" 
                 maxLength={5}
                 style={{ marginTop: '8px', marginBottom: '12px', letterSpacing: '2px', textTransform: 'uppercase', textAlign: 'center', fontSize: '18px', fontWeight: 600 }} 
              />
              <button className="btn-primary" onClick={handleSendRequest} disabled={!targetCode || targetCode.length < 5} style={{ width: '100%', padding: '12px' }}>Solicitar Chat</button>
              {status && <div style={{ fontSize: '13px', marginTop: '10px', textAlign: 'center', color: status.includes('Error') ? 'var(--color-danger)' : 'var(--color-success)' }}>{status}</div>}
            </div>
          </div>
        )}

        {activeTab === 'pending' && (
          <div style={{ animation: 'fadeIn 0.2s ease-out' }}>
            {pendingList.length === 0 ? <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', textAlign: 'center', padding: '20px 0' }}>No tienes solicitudes pendientes.</p> : null}
            {pendingList.map(req => (
              <div key={req.id} style={{ background: 'rgba(0,0,0,0.2)', padding: '16px', borderRadius: '10px', marginBottom: '12px', border: '1px solid var(--color-divider)' }}>
                <p style={{ fontSize: '14px', margin: '0 0 12px 0' }}>El código <strong style={{ color: 'var(--color-accent-light)', letterSpacing: '1px' }}>{req.fromPublicCode}</strong> quiere conectar.</p>
                {acceptingId === req.id ? (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input autoFocus placeholder="PIN (4 dígitos)" maxLength={4} type="password" value={confirmPin} onChange={e=>setConfirmPin(e.target.value)} className="form-input" style={{ width: '120px', textAlign: 'center' }}/>
                    <button className="btn-primary" onClick={() => handleAccept(req.id)} style={{ flex: 1, padding: '8px' }}>Aceptar</button>
                  </div>
                ) : (
                  <button className="btn-primary" onClick={() => { setAcceptingId(req.id); setConfirmPin(''); }} style={{ width: '100%', fontSize: '13px', padding: '10px' }}>Ingresar PIN de {req.fromPublicCode}</button>
                )}
              </div>
            ))}
          </div>
        )}

      </div>
      <style>{`
        .modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 9999; }
        .btn-secondary { background: var(--color-bg); border: 1px solid var(--color-divider); color: var(--color-text); cursor: pointer; border-radius: 8px; transition: all 0.2s; font-weight: 500; }
        .btn-secondary:hover { background: rgba(255,255,255,0.05); }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
}
