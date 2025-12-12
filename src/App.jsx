import { useEffect, useMemo, useState } from 'react'
import { connect, disconnect, isConnected, request, getLocalStorage } from '@stacks/connect'
import './App.css'

function App() {
  const [network, setNetwork] = useState('mainnet')
  const [feeRate, setFeeRate] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [threshold, setThreshold] = useState(300)

  const baseUrl = network === 'mainnet' ? 'https://api.hiro.so' : 'https://api.testnet.hiro.so'
  const contractAddress = 'SP2QNSNKR3NRDWNTX0Q7R4T8WGBJ8RE8RA516AKZP'
  const contractName = 'blockdew'

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
  const fetchContractState = async () => {
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
      const p = pausedRes && pausedRes.result && pausedRes.result.startsWith('0x')
        ? Number(pausedRes.result.slice(-2)) === 1
        : null
      let f = null
      if (feeRes && feeRes.result) {
        const hex = feeRes.result.replace(/^0x/, '')
        try {
          const buf = Buffer.from(hex, 'hex')
          f = BigInt(`0x${hex}`)
        } catch {
          f = null
        }
      }
      setPaused(p)
      setChainFee(f)
    } catch {
      setPaused(null)
      setChainFee(null)
    }
  }

  useEffect(() => {
    fetchContractState()
  }, [baseUrl])

  const [connected, setConnected] = useState(false)
  useEffect(() => {
    setConnected(isConnected())
  }, [])

  const doConnect = async () => {
    await connect()
    setConnected(isConnected())
  }
  const doDisconnect = async () => {
    await disconnect()
    setConnected(isConnected())
  }

  const callPause = async () => {
    await request('stx_callContract', {
      contractAddress,
      contractName,
      functionName: 'pause',
      functionArgs: [],
      postConditions: [],
      postConditionMode: 'deny'
    })
    fetchContractState()
  }
  const callUnpause = async () => {
    await request('stx_callContract', {
      contractAddress,
      contractName,
      functionName: 'unpause',
      functionArgs: [],
      postConditions: [],
      postConditionMode: 'deny'
    })
    fetchContractState()
  }
  const [newFee, setNewFee] = useState('0')
  const callSetFee = async () => {
    const u = Number(newFee)
    if (!Number.isFinite(u) || u < 0) return
    await request('stx_callContract', {
      contractAddress,
      contractName,
      functionName: 'set-fee',
      functionArgs: [{ type: 'uint', value: u.toString() }],
      postConditions: [],
      postConditionMode: 'deny'
    })
    fetchContractState()
  }

  return (
    <div className="container">
      <h1>BlockDew</h1>
      <p className="subtitle">Stacks transaction fee snapshot</p>

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
            <button onClick={callPause} disabled={!connected}>Pause</button>
            <button onClick={callUnpause} disabled={!connected}>Unpause</button>
            <div className="threshold">
              <span>Set fee</span>
              <input type="number" min="0" value={newFee} onChange={(e) => setNewFee(e.target.value)} />
              <button onClick={callSetFee} disabled={!connected}>Apply</button>
            </div>
          </div>
          <div className="status">Paused: {paused === null ? '—' : paused ? 'Yes' : 'No'} | On-chain fee: {chainFee == null ? '—' : String(chainFee)}</div>
        </div>
      </div>
      <div className="footnote">Data: {baseUrl}/v2/fees/transfer</div>
    </div>
  )
}

export default App
