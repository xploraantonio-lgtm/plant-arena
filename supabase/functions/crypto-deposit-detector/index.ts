import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const DEFAULT_BSC_RPC = 'https://bsc-dataseed.binance.org/'
const DEFAULT_USDT_CONTRACT = '0x55d398326f99059fF775485246999027B3197955'
const DEFAULT_TREASURY_WALLET = '0x721622D8cad39621C731eC286D1EA859365A51b8'
const TRANSFER_EVENT_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function padAddressToTopic(address: string): string {
  const clean = address.toLowerCase().replace(/^0x/, '')
  return '0x' + clean.padStart(64, '0')
}

function extractAddressFromTopic(topic: string): string {
  const clean = topic.replace(/^0x/, '')
  return '0x' + clean.slice(24).toLowerCase()
}

// USDT on BSC uses 18 decimals
function parseUint256ToDecimal(hexValue: string, decimals = 18): number {
  const raw = BigInt(hexValue)
  const divisor = BigInt(10 ** decimals)
  const integerPart = raw / divisor
  const remainder = raw % divisor
  const decimalStr = remainder.toString().padStart(decimals, '0')
  return parseFloat(`${integerPart}.${decimalStr}`)
}

async function queryBscRpc(rpcUrl: string, method: string, params: unknown[]): Promise<any> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    }),
  })
  if (!res.ok) {
    throw new Error(`RPC HTTP error: ${res.status} ${res.statusText}`)
  }
  const data = await res.json()
  if (data.error) {
    throw new Error(`RPC error: ${data.error.message || JSON.stringify(data.error)}`)
  }
  return data.result
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !supabaseServiceKey) {
      return json({ success: false, error: 'MISSING_SERVER_CONFIG' }, 500)
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Cargar configuración oficial de tesorería y contrato
    const { data: configRows } = await supabase
      .from('crypto_treasury_config')
      .select('key, value')

    const configMap: Record<string, string> = {}
    configRows?.forEach((r: { key: string; value: string }) => {
      configMap[r.key] = r.value
    })

    const treasuryAddress = configMap['bsc_treasury_wallet'] || DEFAULT_TREASURY_WALLET
    const usdtContract = configMap['usdt_bep20_contract'] || DEFAULT_USDT_CONTRACT
    const RPC_ENDPOINTS = [
      Deno.env.get('BSC_RPC_URL'),
      'https://bsc-dataseed1.binance.org/',
      'https://bsc-dataseed2.binance.org/',
      'https://binance.llamarpc.com',
      'https://bsc-rpc.publicnode.com',
    ].filter(Boolean) as string[]

    let latestBlock = 0
    let chosenRpc = RPC_ENDPOINTS[0]

    for (const rpc of RPC_ENDPOINTS) {
      try {
        const latestBlockHex = await queryBscRpc(rpc, 'eth_blockNumber', [])
        latestBlock = parseInt(latestBlockHex, 16)
        chosenRpc = rpc
        break
      } catch {
        continue
      }
    }

    if (!latestBlock) {
      return json({ success: false, error: 'NO_BSC_RPC_AVAILABLE' }, 500)
    }

    // Escanear últimos 90 bloques (~4.5 minutos en BSC, compatible con RPCs públicos)
    const scanFromBlock = Math.max(0, latestBlock - 90)
    const fromBlockHex = '0x' + scanFromBlock.toString(16)

    let logs: any[] = []
    for (const rpc of [chosenRpc, ...RPC_ENDPOINTS.filter(r => r !== chosenRpc)]) {
      try {
        logs = await queryBscRpc(rpc, 'eth_getLogs', [
          {
            fromBlock: fromBlockHex,
            toBlock: 'latest',
            address: usdtContract.toLowerCase(),
            topics: [
              TRANSFER_EVENT_TOPIC,
              null, // from (any sender)
              padAddressToTopic(treasuryAddress), // to (Plant Arena Treasury)
            ],
          },
        ])
        break
      } catch {
        continue
      }
    }

    const processedResults = []

    for (const log of logs) {
      try {
        const txHash = log.transactionHash
        const logIndex = parseInt(log.logIndex, 16)
        const blockNumber = parseInt(log.blockNumber, 16)
        const sender = extractAddressFromTopic(log.topics[1])
        const destination = extractAddressFromTopic(log.topics[2])
        const amountUsdt = parseUint256ToDecimal(log.data, 18)
        const confirmations = Math.max(1, latestBlock - blockNumber)

        const { data: rpcRes, error: rpcErr } = await (supabase.rpc as any)(
          'process_verified_deposit',
          {
            p_network: 'bsc-mainnet',
            p_token_contract: usdtContract,
            p_tx_hash: txHash,
            p_log_index: logIndex,
            p_block_number: blockNumber,
            p_sender_address: sender,
            p_destination_address: destination,
            p_amount_usdt: amountUsdt,
            p_confirmations: confirmations,
          }
        )

        processedResults.push({
          txHash,
          logIndex,
          sender,
          amountUsdt,
          result: rpcRes,
          error: rpcErr?.message || null,
        })
      } catch (err: any) {
        processedResults.push({
          log,
          error: err?.message || String(err),
        })
      }
    }

    return json({
      success: true,
      scannedBlockRange: { from: scanFromBlock, to: latestBlock },
      transfersFound: logs.length,
      processed: processedResults,
    })
  } catch (err: any) {
    return json({ success: false, error: err?.message || String(err) }, 500)
  }
})
