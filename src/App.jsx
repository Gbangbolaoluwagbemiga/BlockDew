import { useEffect, useMemo, useState, useCallback } from 'react'
import { connect, disconnect, isConnected, request } from '@stacks/connect'
import { uintCV, hexToCV, serializeCV, cvToString } from '@stacks/transactions'
import './App.css'

function App() {
  const [network, setNetwork] = useState('mainnet')
  const [feeRate, setFeeRate] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [threshold, setThreshold] = useState(300)
  const [stateLoading, setStateLoading] = useState(false)
  const [contractBusy, setContractBusy] = useState(false)
  const [txMessage, setTxMessage] = useState('')
  const [theme, setTheme] = useState(() => {
    const saved = globalThis.localStorage?.getItem('theme')
    return saved === 'light' || saved === 'dark' ? saved : 'dark'
  })

  const baseUrl = network === 'mainnet' ? 'https://api.hiro.so' : 'https://api.testnet.hiro.so'
  const contractAddress = 'SP2QNSNKR3NRDWNTX0Q7R4T8WGBJ8RE8RA516AKZP'
  const contractName = 'blockdew'
  useEffect(() => {
    const root = document.documentElement
    root.classList.remove('theme-light', 'theme-dark')
    root.classList.add(theme === 'light' ? 'theme-light' : 'theme-dark')
    if (globalThis.localStorage) {
      globalThis.localStorage.setItem('theme', theme)
    }
  }, [theme])
  const toggleTheme = () => setTheme((t) => (t === 'light' ? 'dark' : 'light'))

  const isGoodTime = useMemo(() => {
    if (feeRate == null) return null
    return feeRate <= Number(threshold)
  }, [feeRate, threshold])

  const tiers = useMemo(() => {
    if (feeRate == null) return null
    const low = Math.max(1, Math.round(feeRate * 0.8))
    const avg = Math.round(feeRate)
    const high = Math.round(feeRate * 1.2)
    return { low, avg, high }
  }, [feeRate])

  useEffect(() => {
    const fetchFee = async () => {
      setLoading(true)
      setError('')
      try {
        const res = await fetch(`${baseUrl}/v2/fees/transfer`, { headers: { Accept: 'application/json' } })
        const text = await res.text()
        let rate
        try {
          const json = JSON.parse(text)
          rate = typeof json === 'number' ? json : json.fee_rate ?? json.estimated_fee_rate ?? null
        } catch {
          const n = Number(String(text).replace(/[^0-9.]/g, ''))
          rate = Number.isFinite(n) ? n : null
        }
        if (rate == null) throw new Error('Unable to parse fee rate')
        setFeeRate(rate)
      } catch {
        setError('Failed to load fee rate')
        setFeeRate(null)
      } finally {
        setLoading(false)
      }
    }
    fetchFee()
  }, [baseUrl])

  const [paused, setPaused] = useState(null)
  const [chainFee, setChainFee] = useState(null)
  const fetchContractState = useCallback(async () => {
    setStateLoading(true)
    try {
      const sender = contractAddress
      const read = async (fn) => {
        const res = await fetch(`${baseUrl}/v2/contracts/call-read/${contractAddress}/${contractName}/${fn}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sender, arguments: [] })
        })
        const json = await res.json()
        return json
      }
      const pausedRes = await read('is-paused')
      const feeRes = await read('get-fee')
      const p = pausedRes && pausedRes.result ? (() => {
        try {
          const s = cvToString(hexToCV(pausedRes.result))
          const m = s.match(/\(ok\s+(true|false)\)/)
          return m ? m[1] === 'true' : null
        } catch { return null }
      })() : null
      let f = null
      if (feeRes && feeRes.result) {
        try {
          const s = cvToString(hexToCV(feeRes.result))
          const m = s.match(/\(ok\s+u([0-9]+)\)/)
          f = m ? BigInt(m[1]) : null
        } catch { f = null }
      }
      setPaused(p)
      setChainFee(f)
    } catch {
      setPaused(null)
      setChainFee(null)
    } finally {
      setStateLoading(false)
    }
  }, [baseUrl, contractAddress, contractName])

  const waitForTx = async (txId) => {
    if (!txId) return null
    setTxMessage('Waiting for confirmation…')
    let status = null
    for (let i = 0; i < 60; i++) {
      try {
        const res = await fetch(`${baseUrl}/extended/v1/tx/${txId}?unanchored=true`)
        const json = await res.json()
        status = json.tx_status || json.status || null
        if (status === 'success' || status === 'abort_by_response') break
      } catch { continue }
      await new Promise((r) => setTimeout(r, 2000))
    }
    if (status === 'success') setTxMessage('Confirmed')
    else if (status === 'abort_by_response') setTxMessage('Failed')
    else setTxMessage('Pending or unknown')
    return status
  }

  useEffect(() => { fetchContractState() }, [fetchContractState])

  const [connected, setConnected] = useState(false)
  useEffect(() => {
    setConnected(isConnected())
  }, [])

  const doConnect = async () => {
    await connect({ forceWalletSelect: true })
    setConnected(isConnected())
  }
  const doDisconnect = async () => {
    await disconnect()
    setConnected(isConnected())
  }

  const callPause = async () => {
    setContractBusy(true)
    try {
      const res = await request('stx_callContract', {
        contract: `${contractAddress}.${contractName}`,
        functionName: 'pause',
        functionArgs: [],
        postConditions: [],
        postConditionMode: 'deny'
      })
      const txId = typeof res === 'string' ? res : (res?.txId || res?.txid || null)
      await waitForTx(txId)
      await fetchContractState()
    } finally {
      setContractBusy(false)
    }
  }
  const callUnpause = async () => {
    setContractBusy(true)
    try {
      const res = await request('stx_callContract', {
        contract: `${contractAddress}.${contractName}`,
        functionName: 'unpause',
        functionArgs: [],
        postConditions: [],
        postConditionMode: 'deny'
      })
      const txId = typeof res === 'string' ? res : (res?.txId || res?.txid || null)
      await waitForTx(txId)
      await fetchContractState()
    } finally {
      setContractBusy(false)
    }
  }
  const [newFee, setNewFee] = useState('0')
  const callSetFee = async () => {
    const u = Number(newFee)
    if (!Number.isFinite(u) || u < 0) return
    const bytes = serializeCV(uintCV(u))
    const argHex = '0x' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
    setContractBusy(true)
    try {
      const res = await request('stx_callContract', {
        contract: `${contractAddress}.${contractName}`,
        functionName: 'set-fee',
        functionArgs: [argHex],
        postConditions: [],
        postConditionMode: 'deny'
      })
      const txId = typeof res === 'string' ? res : (res?.txId || res?.txid || null)
      await waitForTx(txId)
      await fetchContractState()
    } finally {
      setContractBusy(false)
    }
  }

  return (
    <div className="container">
      <h1>BlockDew</h1>
      <p className="subtitle">Stacks transaction fee snapshot</p>
      {(stateLoading || contractBusy) && (
        <div className="overlay-fixed">
          <div className="overlay-content">
            <div className="spinner spinner-lg" aria-label="Loading" />
            <div className="overlay-text">{contractBusy ? (txMessage || 'Submitting transaction…') : 'Loading contract state…'}</div>
          </div>
        </div>
      )}

      <div className="controls">
        <label className={network === 'mainnet' ? 'active' : ''}>
          <input type="radio" name="network" value="mainnet" checked={network === 'mainnet'} onChange={() => setNetwork('mainnet')} />
          Mainnet
        </label>
        <label className={network === 'testnet' ? 'active' : ''}>
          <input type="radio" name="network" value="testnet" checked={network === 'testnet'} onChange={() => setNetwork('testnet')} />
          Testnet
        </label>
        <div className="threshold">
          <span>Alert threshold</span>
          <input type="number" min="1" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
        </div>
        <button className="refresh" onClick={() => setNetwork((n) => n)} disabled={loading}>Refresh</button>
        <button className="icon-btn" onClick={toggleTheme} title={theme === 'light' ? 'Switch to dark' : 'Switch to light'} aria-label="Toggle theme">
          {theme === 'light' ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>
      </div>

      <div className="panel">
        {loading && <div className="status">Loading…</div>}
        {error && <div className="status error">{error}</div>}
        {!loading && !error && feeRate != null && (
          <div className="grid">
            <div className="tile">
              <div className="label">Current fee rate</div>
              <div className="value">{feeRate}</div>
              <div className={`badge ${isGoodTime ? 'good' : 'bad'}`}>{isGoodTime ? 'Good time' : 'Busy time'}</div>
            </div>
            {tiers && (
              <>
                <div className="tile">
                  <div className="label">Low</div>
                  <div className="value">{tiers.low}</div>
                </div>
                <div className="tile">
                  <div className="label">Avg</div>
                  <div className="value">{tiers.avg}</div>
                </div>
                <div className="tile">
                  <div className="label">High</div>
                  <div className="value">{tiers.high}</div>
                </div>
              </>
            )}
          </div>
        )}
        <div className="actions">
          <div className="controls">
            {!connected ? (
              <button onClick={doConnect}>Connect Wallet</button>
            ) : (
              <button onClick={doDisconnect}>Disconnect</button>
            )}
            <button onClick={callPause} disabled={!connected || contractBusy}>Pause</button>
            <button onClick={callUnpause} disabled={!connected || contractBusy}>Unpause</button>
            <div className="threshold">
              <span>Set fee</span>
              <input type="number" min="0" value={newFee} onChange={(e) => setNewFee(e.target.value)} />
              <button onClick={callSetFee} disabled={!connected || contractBusy}>Apply</button>
            </div>
            {(stateLoading || contractBusy) && (
              <div className="spinner" aria-label="Loading contract" />
            )}
          </div>
          <div className="status">
            State: {paused === null ? '—' : paused ? 'Inactive' : 'Active'}
            {' '}| Paused: {paused === null ? '—' : paused ? 'Yes' : 'No'}
            {' '}| On-chain fee: {chainFee == null ? '—' : String(chainFee)}
            {txMessage && <> | {txMessage}</>}
          </div>
        </div>
      </div>
      <div className="footnote">Data: {baseUrl}/v2/fees/transfer</div>
    </div>
  )
}

export default App
