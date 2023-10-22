// deno-lint-ignore-file no-explicit-any
import { Blockfrost, Lucid, OutRef, UTxO, fromText } from "https://deno.land/x/lucid@0.10.7/mod.ts"
import { config } from "https://deno.land/x/dotenv@v3.2.2/mod.ts";
import { burnAdaPoolTokenSetAsync, createMintPolicyWithAddress, getPolicyId, mintAdaPoolTokenSetAsync } from "./asset.ts";
import { PoolTokenSet, createAdaPool, createScriptReferenceAsync, createSwapOrder, depositValidatorScript, executeSwapOrderAsync, extractTokenInfo, findPoolData, poolValidatorAddress, poolValidatorScript, redeemValidatorScript, submitSwapOrderAsync, swapValidatorAddress, swapValidatorScript } from "./validator.ts";

const env = config();

const apiKey = env["BLOCKFROST_API_KEY"];
const walletSeed = env["WALLET_SEED"];

if (!apiKey) {
  throw new Error("BLOCKFROST_API_KEY environment variable not set");
}

const lucid = await Lucid.new(
  new Blockfrost(
    "https://cardano-preview.blockfrost.io/api/v0",
    apiKey,
  ),
  "Preview",
);

lucid.selectWalletFromSeed(
  walletSeed,
  {
    addressType: "Base",
    accountIndex: 0,
  },
);

const changeAddr = await lucid.wallet.address();
const addressDetails = lucid.utils.getAddressDetails(changeAddr);
const pkh = addressDetails.paymentCredential?.hash;
const skh = addressDetails.stakeCredential?.hash;

const toJson = (data: any) => {
  // look for bigint and convert to string
  const replacer = (_: any, value: any) =>
    typeof value === "bigint" ? value.toString() : value;
  return JSON.stringify(data, replacer);
};

const fromJson = (data: any) => {
  // look for string and convert to bigint
  const reviver = (_: any, value: any) =>
    typeof value === "string" && /^\d+$/.test(value)
      ? BigInt(value)
      : value;
  return JSON.parse(data, reviver);
}

const adminPolicyId = getPolicyId(lucid, createMintPolicyWithAddress(lucid, changeAddr));

if (Deno.args.includes("--mint-pool-token")) {
  const token = Deno.args[Deno.args.indexOf("--mint-pool-token") + 1];
  console.log(`Minting ${token} Pool Token Set`);
  const result = await mintAdaPoolTokenSetAsync(lucid, changeAddr, token);
  // Write the result as json file
  const encoder = new TextEncoder();
  const data = encoder.encode(toJson(result));
  // Store in pools directory create if not exists
  await Deno.mkdir("pools", { recursive: true });
  await Deno.writeFile(`pools/${token}_pool.json`, data);
}

if (Deno.args.includes("--burn-pool-token")) {
  const token = Deno.args[Deno.args.indexOf("--burn-pool-token") + 1];
  console.log(`Burning ${token} Pool Token Set`);
  await burnAdaPoolTokenSetAsync(lucid, changeAddr, token);
  // Remove the pool token json file
  await Deno.remove(`pools/${token}_pool.json`);
}

if (Deno.args.includes("--create-pool-reference")) {
  const scriptRefUtxo = await createScriptReferenceAsync(lucid, poolValidatorScript);
  console.log("Script Reference Utxo", scriptRefUtxo);
  // Write the result as json file
  const encoder = new TextEncoder();
  const data = encoder.encode(toJson(scriptRefUtxo));
  await Deno.mkdir("script_reference", { recursive: true });
  await Deno.writeFile(`script_reference/pool_script_ref.json`, data);
}

if (Deno.args.includes("--create-swap-reference")) {
  const scriptRefUtxo = await createScriptReferenceAsync(lucid, swapValidatorScript);
  console.log("Script Reference Utxo", scriptRefUtxo);
  // Write the result as json file
  const encoder = new TextEncoder();
  const data = encoder.encode(toJson(scriptRefUtxo));
  await Deno.mkdir("script_reference", { recursive: true });
  await Deno.writeFile(`script_reference/swap_script_ref.json`, data);
}

if (Deno.args.includes("--create-deposit-reference")) {
  const scriptRefUtxo = await createScriptReferenceAsync(lucid, depositValidatorScript);
  console.log("Script Reference Utxo", scriptRefUtxo);
  // Write the result as json file
  const encoder = new TextEncoder();
  const data = encoder.encode(toJson(scriptRefUtxo));
  await Deno.mkdir("script_reference", { recursive: true });
  await Deno.writeFile(`script_reference/deposit_script_ref.json`, data);
}

if (Deno.args.includes("--create-redeem-reference")) {
  const scriptRefUtxo = await createScriptReferenceAsync(lucid, redeemValidatorScript);
  console.log("Script Reference Utxo", scriptRefUtxo);
  // Write the result as json file
  const encoder = new TextEncoder();
  const data = encoder.encode(toJson(scriptRefUtxo));
  await Deno.mkdir("script_reference", { recursive: true });
  await Deno.writeFile(`script_reference/redeem_script_ref.json`, data);
}

if (Deno.args.includes("--create-pool")) {
  const token = Deno.args[Deno.args.indexOf("--create-pool") + 1];
  console.log(`Creating ${token} Pool`);
  const data = await Deno.readFile(`pools/${token}_pool.json`);
  const poolTokenSet = fromJson(new TextDecoder().decode(data));
  const poolAddr = poolValidatorAddress(lucid);
  const txHash = await createAdaPool(lucid, poolTokenSet, changeAddr, poolAddr, adminPolicyId);
  console.log(`Created ${token} Pool`, txHash);
}

if (Deno.args.includes("--swap-order")) {
  // Token
  const token = Deno.args[Deno.args.indexOf("--swap-order") + 1];
  // Amount
  const amount = BigInt(Deno.args[Deno.args.indexOf("--swap-order") + 2]);

  const data = await Deno.readFile(`pools/${token}_pool.json`);
  const poolTokenSet = fromJson(new TextDecoder().decode(data)) as PoolTokenSet;
  const poolTokenInfo = extractTokenInfo(poolTokenSet);

  const poolTokenIdentity = poolTokenInfo.identity.policyId + fromText(poolTokenInfo.identity.tokenName);

  // load pool script reference
  const data2 = await Deno.readFile(`script_reference/pool_script_ref.json`);
  const poolScriptRef = fromJson(new TextDecoder().decode(data2)) as OutRef;
  const poolAddr = poolValidatorAddress(lucid);
  const swapAddr = swapValidatorAddress(lucid);
  const [scriptRef, poolUtxo, poolDatum] = await findPoolData(lucid, poolAddr, poolTokenIdentity, poolScriptRef);
  console.log("PoolData", { scriptRef, poolUtxo, poolDatum });

  const [swapDatum, minAda] = createSwapOrder(
    true,
    amount,
    2000000n,
    2000000n,
    BigInt(20),
    poolDatum!,
    poolUtxo.assets,
    pkh!,
    skh!,
    ["", ""]
  );

  // console.log({swapDatum});
  // console.log("Swap Datum Cbor", Data.to<SwapDatum>(swapDatum, SwapDatum));

  console.log("SwapOrder: ", swapDatum, minAda);
  console.log("Submitting Swap Order");
  const swapTxHash = await submitSwapOrderAsync(swapDatum, minAda, swapAddr, lucid);
  console.log("Swap Order Submitted", swapTxHash);
}

if (Deno.args.includes("--execute-swap-order")) {
  const swapOrderUtxoStr = Deno.args[Deno.args.indexOf("--execute-swap-order") + 1];

  const swapOrderUtxos = await lucid.provider.getUtxosByOutRef([{
    txHash: swapOrderUtxoStr.split("#")[0],
    outputIndex: parseInt(swapOrderUtxoStr.split("#")[1]),
  }]);

  console.log("SwapOrderUtxo", swapOrderUtxos[0]);

  const poolToken = Deno.args[Deno.args.indexOf("--execute-swap-order") + 2];

  const poolData = await Deno.readFile(`pools/${poolToken}_pool.json`);
  const poolTokenSet = fromJson(new TextDecoder().decode(poolData)) as PoolTokenSet;
  const poolTokenInfo = extractTokenInfo(poolTokenSet);

  const poolTokenIdentity = poolTokenInfo.identity.policyId + fromText(poolTokenInfo.identity.tokenName);

  const poolScriptRefData = await Deno.readFile(`script_reference/pool_script_ref.json`);
  const poolScriptRefObj = fromJson(new TextDecoder().decode(poolScriptRefData)) as OutRef;

  const swapScriptRefData = await Deno.readFile(`script_reference/swap_script_ref.json`);
  const swapScriptRefObj = fromJson(new TextDecoder().decode(swapScriptRefData)) as UTxO;
  const swapScriptRef = await lucid.provider.getUtxosByOutRef([swapScriptRefObj]);

  const poolAddr = poolValidatorAddress(lucid);
  const [scriptRef, poolUtxo, poolDatum] = await findPoolData(lucid, poolAddr, poolTokenIdentity, poolScriptRefObj);

  console.log("PoolData", { scriptRef, poolUtxo, poolDatum });
  await executeSwapOrderAsync(lucid, poolAddr, poolUtxo, poolDatum!, swapOrderUtxos[0], scriptRef, swapScriptRef[0], changeAddr, changeAddr, false);
}