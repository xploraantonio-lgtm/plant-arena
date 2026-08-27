import { createClient } from 'npm:@supabase/supabase-js@2'
import { ethers } from 'npm:ethers@6.13.2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const DEFAULT_BSC_RPC = 'https://bsc-dataseed.binance.org/'
const DEFAULT_USDT_CONTRACT = '0x55d398326f99059fF775485246999027B3197955'
const OFFICIAL_TREASURY_WALLET = '0x721622D8cad39621C731eC286D1EA859365A51b8'

const ERC20_ABI = [
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function transfer(address recipient, uint256 amount) external returns (bool)',
]

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
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

    // Cargar clave privada de la tesorería (almacenada como secret server-side)
    const privateKey = Deno.env.get('BSC_TREASURY_PRIVATE_KEY')
    if (!privateKey || privateKey.trim() === '') {
      return json({
        success: false,
        status: 'SIGNER_KEY_NOT_CONFIGURED',
        message: 'La clave privada de la tesorería (BSC_TREASURY_PRIVATE_KEY) no está configurada en los secrets de Supabase. Los retiros permanecen encolados.',
      })
    }

    // Configuración de red y contrato
    const { data: configRows } = await supabase
      .from('crypto_treasury_config')
      .select('key, value')

    const configMap: Record<string, string> = {}
    configRows?.forEach((r: { key: string; value: string }) => {
      configMap[r.key] = r.value
    })

    const treasuryAddress = configMap['bsc_treasury_wallet'] || OFFICIAL_TREASURY_WALLET
    const usdtContractAddress = configMap['usdt_bep20_contract'] || DEFAULT_USDT_CONTRACT
    const bscRpcUrl = Deno.env.get('BSC_RPC_URL') || DEFAULT_BSC_RPC

    // Inicializar Provider y Signer de BSC
    const provider = new ethers.JsonRpcProvider(bscRpcUrl)
    const signer = new ethers.Wallet(privateKey.trim(), provider)

    // Validar que la clave privada corresponda a la wallet oficial
    if (signer.address.toLowerCase() !== treasuryAddress.toLowerCase()) {
      return json({
        success: false,
        error: 'SIGNER_WALLET_MISMATCH',
        message: `La clave privada corresponde a ${signer.address}, pero la tesorería oficial es ${treasuryAddress}.`,
      }, 500)
    }

    // Verificar saldo nativo de BNB para pagar comisiones de gas
    const bnbBalanceWei = await provider.getBalance(signer.address)
    const minBnbRequired = ethers.parseEther('0.0003') // ~0.0003 BNB por transferencia BEP20
    if (bnbBalanceWei < minBnbRequired) {
      return json({
        success: false,
        error: 'INSUFFICIENT_BNB_GAS',
        message: `La wallet de tesorería no tiene suficiente BNB para gas (${ethers.formatEther(bnbBalanceWei)} BNB disponibles).`,
      }, 500)
    }

    // Inicializar contrato de USDT
    const usdtContract = new ethers.Contract(usdtContractAddress, ERC20_ABI, signer)
    const usdtBalanceWei = await usdtContract.balanceOf(signer.address)

    // Obtener solicitudes de retiro en estado 'requested'
    const { data: pendingWithdrawals, error: fetchErr } = await supabase
      .from('withdrawal_transactions')
      .select('*')
      .eq('status', 'requested')
      .order('created_at', { ascending: true })
      .limit(5)

    if (fetchErr) {
      return json({ success: false, error: fetchErr.message }, 500)
    }

    if (!pendingWithdrawals || pendingWithdrawals.length === 0) {
      return json({ success: true, message: 'No hay solicitudes de retiro pendientes.', processedCount: 0 })
    }

    const processedResults = []

    for (const w of pendingWithdrawals) {
      try {
        const netAmountUsdt = Number(w.net_amount_usdt)
        const amountWei = ethers.parseUnits(netAmountUsdt.toFixed(6), 18)

        // Validar saldo de USDT en tesorería
        if (usdtBalanceWei < amountWei) {
          processedResults.push({
            id: w.id,
            error: 'TREASURY_INSUFFICIENT_USDT',
            message: 'Saldo insuficiente de USDT en la tesorería.',
          })
          continue
        }

        // 1. Marcar como 'processing'
        await supabase
          .from('withdrawal_transactions')
          .update({ status: 'processing', submitted_at: new Date().toISOString() })
          .eq('id', w.id)

        // 2. Firmar y transmitir la transferencia BEP20 on-chain
        const tx = await usdtContract.transfer(w.destination_wallet, amountWei)
        
        // 3. Registrar el hash de la transacción transmitida
        await supabase
          .from('withdrawal_transactions')
          .update({ status: 'broadcasted', tx_hash: tx.hash })
          .eq('id', w.id)

        // 4. Esperar 1 confirmación en BNB Smart Chain
        const receipt = await tx.wait(1)

        if (receipt && receipt.status === 1) {
          // Éxito: Marcar como completed
          await supabase
            .from('withdrawal_transactions')
            .update({
              status: 'completed',
              confirmed_at: new Date().toISOString(),
              completed_at: new Date().toISOString(),
            })
            .eq('id', w.id)

          // Actualizar estado en el ledger general transactions
          await supabase
            .from('transactions')
            .update({ status: 'completed' })
            .eq('user_id', w.user_id)
            .eq('type', 'withdrawal')
            .eq('status', 'pending')

          processedResults.push({
            id: w.id,
            txHash: tx.hash,
            destination: w.destination_wallet,
            netAmountUsdt: netAmountUsdt,
            feeGems: w.fee_gems,
            status: 'completed',
          })
        } else {
          throw new Error('La transacción fue revertida en la blockchain.')
        }
      } catch (txErr: any) {
        // En caso de fallo on-chain, registrar error y reembolsar gemas al usuario
        const errorMsg = txErr?.message || String(txErr)

        await supabase
          .from('withdrawal_transactions')
          .update({ status: 'failed', failure_reason: errorMsg })
          .eq('id', w.id)

        // Reembolsar gemas al balance del jugador para proteger sus fondos
        await supabase.rpc('grant_gems_admin' as any, {
          p_uid: w.user_id,
          p_gems: w.amount_gems,
        })

        await supabase
          .from('transactions')
          .update({ status: 'rejected', description: `Retiro fallido: Reembolsado (${errorMsg})` })
          .eq('user_id', w.user_id)
          .eq('type', 'withdrawal')
          .eq('status', 'pending')

        processedResults.push({
          id: w.id,
          error: errorMsg,
          status: 'failed_and_refunded',
        })
      }
    }

    return json({
      success: true,
      processedCount: processedResults.length,
      results: processedResults,
    })
  } catch (err: any) {
    return json({ success: false, error: err?.message || String(err) }, 500)
  }
})
