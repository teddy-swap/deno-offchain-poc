// deno-lint-ignore-file no-explicit-any
import { Blockfrost, Lucid, Network, OutRef, UTxO, fromText } from "https://deno.land/x/lucid@0.10.7/mod.ts"
import { config } from "https://deno.land/x/dotenv@v3.2.2/mod.ts";
import { burnAdaPoolTokenSetAsync, createMintPolicyWithAddress, createMintPolicyWithAddressLockedBefore, getPolicyId, mintAdaPoolTokenSetAsync } from "./asset.ts";
import { PoolTokenSet, attemptHackPoolAsync, createAdaPoolAsync, createScriptReferenceAsync, createSwapOrder, depositValidatorAddress, depositValidatorScript, executeSwapOrderAsync, extractTokenInfo, findPoolData, mintTokenAsync, poolValidatorAddress, poolValidatorScript, redeemValidatorAddress, redeemValidatorScript, refundSwapOrderAsync, sendTokenAsync, submitSwapOrderAsync, swapValidatorAddress, swapValidatorScript } from "./validator.ts";
import { MAX_LP_CAP } from "./constants.ts";

const env = config();

const apiKey = env["BLOCKFROST_API_KEY"];
const walletSeed = env["WALLET_SEED"];
const network: Network = env["CARDANO_NETWORK"] as Network;
const apiEndpoint = env["API_ENDPOINT"];

if (!apiKey) {
  throw new Error("BLOCKFROST_API_KEY environment variable not set");
}

const lucid = await Lucid.new(
  new Blockfrost(
    apiEndpoint,
    apiKey,
  ),
  network,
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

const getAddressByIndexAsync = async (index: number) => {
  const l = await Lucid.new(
    new Blockfrost(
      apiEndpoint,
      apiKey,
    ),
    network,
  );
  
  l.selectWalletFromSeed(
    walletSeed,
    {
      addressType: "Base",
      accountIndex: index,
    },
  );

  return await l.wallet.address();
}

const adminPolicyId = getPolicyId(lucid, createMintPolicyWithAddress(lucid, changeAddr));

const poolAddr = poolValidatorAddress(lucid, lucid.utils.stakeCredentialOf(changeAddr));
const swapAddr = swapValidatorAddress(lucid, lucid.utils.stakeCredentialOf(changeAddr));
const depositAddr = depositValidatorAddress(lucid, lucid.utils.stakeCredentialOf(changeAddr));
const redeemAddr = redeemValidatorAddress(lucid, lucid.utils.stakeCredentialOf(changeAddr));

console.log(JSON.stringify({ changeAddr, poolAddr, swapAddr, depositAddr, redeemAddr }));

if (Deno.args.includes("--address")) {
  console.log(changeAddr);
}

if (Deno.args.includes("--slot")) {
  console.log(lucid.currentSlot());
}

if (Deno.args.includes("--mint-unlocked-before")) {
  const token = Deno.args[Deno.args.indexOf("--mint-unlocked-before") + 1];
  const amount = BigInt(Deno.args[Deno.args.indexOf("--mint-unlocked-before") + 2]);
  const before = parseInt(Deno.args[Deno.args.indexOf("--mint-unlocked-before") + 3]);
  console.log(`Minting ${amount} ${token} with unlocked before ${before}`);
  const mintPolicy = createMintPolicyWithAddressLockedBefore(lucid, changeAddr, before);
  const policyId = lucid.utils.mintingPolicyToId(mintPolicy);
  const unit = policyId + fromText(token);
  await mintTokenAsync(lucid, mintPolicy, unit, amount);
}

// Mint LP Tokens
// Optional can provide slot to lock the LP tokens
if (Deno.args.includes("--mint-lp")) {
  const token = Deno.args[Deno.args.indexOf("--mint-lp") + 1];
  const amount = MAX_LP_CAP;

  const slot = Deno.args.includes("--mint-lp")
    ? parseInt(Deno.args[Deno.args.indexOf("--mint-lp") + 2])
    : lucid.currentSlot() + 300;

  console.log(`Minting LP: ${amount} ${token} with unlocked before ${slot}`);
  const mintPolicy = createMintPolicyWithAddressLockedBefore(lucid, changeAddr, slot);
  const policyId = lucid.utils.mintingPolicyToId(mintPolicy);
  const unit = policyId + fromText(token);
  await mintTokenAsync(lucid, mintPolicy, unit, amount);
}

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
  const scriptRefUtxo = await createScriptReferenceAsync(lucid, poolValidatorScript, lucid.utils.stakeCredentialOf(changeAddr));
  console.log("Script Reference Utxo", scriptRefUtxo);
  // Write the result as json file
  const encoder = new TextEncoder();
  const data = encoder.encode(toJson(scriptRefUtxo));
  await Deno.mkdir("script_reference", { recursive: true });
  await Deno.writeFile(`script_reference/pool_script_ref.json`, data);
}

if (Deno.args.includes("--create-swap-reference")) {
  const scriptRefUtxo = await createScriptReferenceAsync(lucid, swapValidatorScript, lucid.utils.stakeCredentialOf(changeAddr));
  console.log("Script Reference Utxo", scriptRefUtxo);
  // Write the result as json file
  const encoder = new TextEncoder();
  const data = encoder.encode(toJson(scriptRefUtxo));
  await Deno.mkdir("script_reference", { recursive: true });
  await Deno.writeFile(`script_reference/swap_script_ref.json`, data);
}

if (Deno.args.includes("--create-deposit-reference")) {
  const scriptRefUtxo = await createScriptReferenceAsync(lucid, depositValidatorScript, lucid.utils.stakeCredentialOf(changeAddr));
  console.log("Script Reference Utxo", scriptRefUtxo);
  // Write the result as json file
  const encoder = new TextEncoder();
  const data = encoder.encode(toJson(scriptRefUtxo));
  await Deno.mkdir("script_reference", { recursive: true });
  await Deno.writeFile(`script_reference/deposit_script_ref.json`, data);
}

if (Deno.args.includes("--create-redeem-reference")) {
  const scriptRefUtxo = await createScriptReferenceAsync(lucid, redeemValidatorScript, lucid.utils.stakeCredentialOf(changeAddr));
  console.log("Script Reference Utxo", scriptRefUtxo);
  // Write the result as json file
  const encoder = new TextEncoder();
  const data = encoder.encode(toJson(scriptRefUtxo));
  await Deno.mkdir("script_reference", { recursive: true });
  await Deno.writeFile(`script_reference/redeem_script_ref.json`, data);
}

if (Deno.args.includes("--create-pool")) {
  const token = Deno.args[Deno.args.indexOf("--create-pool") + 1];

  const adaAmount = BigInt(Deno.args[Deno.args.indexOf("--create-pool") + 2]);
  const tokenAmount = BigInt(Deno.args[Deno.args.indexOf("--create-pool") + 3]);

  const stakeKeyIndexArg = Deno.args[Deno.args.indexOf("--create-pool") + 4];
  const stakeKeyIndex = stakeKeyIndexArg ? parseInt(stakeKeyIndexArg) : 0;

  const adminAddress = await getAddressByIndexAsync(stakeKeyIndex);
  const adminPolicyIdByIdx = getPolicyId(lucid, createMintPolicyWithAddress(lucid, adminAddress));
  const poolAddrByIdx = poolValidatorAddress(lucid, lucid.utils.stakeCredentialOf(adminAddress));

  console.log(`Creating ${token} Pool with stake key index ${stakeKeyIndex} and admin policy id ${adminPolicyIdByIdx}`);
  
  const data = await Deno.readFile(`pools/${token}_pool.json`);
  const poolTokenSet = fromJson(new TextDecoder().decode(data));
  const txHash = await createAdaPoolAsync(lucid, poolTokenSet, changeAddr, poolAddrByIdx, adminPolicyIdByIdx, adaAmount, tokenAmount);
  console.log(`Created ${token} Pool`, txHash);
}

if (Deno.args.includes("--swap-order")) {
  // Token
  const token = Deno.args[Deno.args.indexOf("--swap-order") + 1];
  // Amount
  const amount = BigInt(Deno.args[Deno.args.indexOf("--swap-order") + 2]);

  const customPoolAddr = Deno.args[Deno.args.indexOf("--swap-order") + 3];

  const data = await Deno.readFile(`pools/${token}_pool.json`);
  const poolTokenSet = fromJson(new TextDecoder().decode(data)) as PoolTokenSet;
  const poolTokenInfo = extractTokenInfo(poolTokenSet);

  const poolTokenIdentity = poolTokenInfo.identity.policyId + fromText(poolTokenInfo.identity.tokenName);

  // load pool script reference
  const data2 = await Deno.readFile(`script_reference/pool_script_ref.json`);
  const poolScriptRef = fromJson(new TextDecoder().decode(data2)) as OutRef;
  const [scriptRef, poolUtxo, poolDatum] = await findPoolData(lucid, customPoolAddr != null ? customPoolAddr : poolAddr, poolTokenIdentity, poolScriptRef);
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

  const customPoolAddr = Deno.args[Deno.args.indexOf("--execute-swap-order") + 3];

  const poolData = await Deno.readFile(`pools/${poolToken}_pool.json`);
  const poolTokenSet = fromJson(new TextDecoder().decode(poolData)) as PoolTokenSet;
  const poolTokenInfo = extractTokenInfo(poolTokenSet);

  const poolTokenIdentity = poolTokenInfo.identity.policyId + fromText(poolTokenInfo.identity.tokenName);

  const poolScriptRefData = await Deno.readFile(`script_reference/pool_script_ref.json`);
  const poolScriptRefObj = fromJson(new TextDecoder().decode(poolScriptRefData)) as OutRef;

  const swapScriptRefData = await Deno.readFile(`script_reference/swap_script_ref.json`);
  const swapScriptRefObj = fromJson(new TextDecoder().decode(swapScriptRefData)) as UTxO;
  const swapScriptRef = await lucid.provider.getUtxosByOutRef([swapScriptRefObj]);

  const [scriptRef, poolUtxo, poolDatum] = await findPoolData(lucid, poolAddr, poolTokenIdentity, poolScriptRefObj);

  console.log("PoolData", { scriptRef, poolUtxo, poolDatum, poolAddr: customPoolAddr != null ? customPoolAddr : poolAddr });
  await executeSwapOrderAsync(lucid, customPoolAddr != null ? customPoolAddr : poolAddr, poolUtxo, poolDatum!, swapOrderUtxos[0], scriptRef, swapScriptRef[0], changeAddr, changeAddr, false);
}

if (Deno.args.includes("--refund-swap-order")) {
  const swapOrderUtxoStr = Deno.args[Deno.args.indexOf("--refund-swap-order") + 1];

  const swapOrderUtxos = await lucid.provider.getUtxosByOutRef([{
    txHash: swapOrderUtxoStr.split("#")[0],
    outputIndex: parseInt(swapOrderUtxoStr.split("#")[1]),
  }]);

  const swapScriptRefData = await Deno.readFile(`script_reference/swap_script_ref.json`);
  const swapScriptRefObj = fromJson(new TextDecoder().decode(swapScriptRefData)) as UTxO;
  const swapScriptRef = await lucid.provider.getUtxosByOutRef([swapScriptRefObj]);

  console.log("SwapOrderUtxo", swapOrderUtxos[0]);
  console.log("SwapRefUtxo", swapScriptRef[0]);

  await refundSwapOrderAsync(lucid, swapOrderUtxos[0], swapScriptRef[0], changeAddr);
}

if (Deno.args.includes("--hack-pool")) {
  const poolToken = Deno.args[Deno.args.indexOf("--hack-pool") + 1];
  const poolData = await Deno.readFile(`pools/${poolToken}_pool.json`);
  const poolTokenSet = fromJson(new TextDecoder().decode(poolData)) as PoolTokenSet;
  const poolTokenInfo = extractTokenInfo(poolTokenSet);

  const poolTokenIdentity = poolTokenInfo.identity.policyId + fromText(poolTokenInfo.identity.tokenName);

  const poolScriptRefData = await Deno.readFile(`script_reference/pool_script_ref.json`);
  const poolScriptRefObj = fromJson(new TextDecoder().decode(poolScriptRefData)) as OutRef;

  const [scriptRef, poolUtxo] = await findPoolData(lucid, poolAddr, poolTokenIdentity, poolScriptRefObj);
  console.log("PoolData", { scriptRef, poolUtxo });
  await attemptHackPoolAsync(lucid, scriptRef, poolUtxo, adminPolicyId);
}

// Send Token to Address
if (Deno.args.includes("--send")) {
  const unit = Deno.args[Deno.args.indexOf("--send") + 1];
  const address = Deno.args[Deno.args.indexOf("--send") + 2];
  const amount = BigInt(Deno.args[Deno.args.indexOf("--send") + 3]);
  console.log(`Sending ${amount} ${unit} to ${address}`);

  await sendTokenAsync(lucid, unit, amount, address);
}

if (Deno.args.includes("--test")) {
  const l = lucid.selectWalletFromPrivateKey("ed25519_sk1nmjs7jd3y20l0rcxzw0hxp3k5v6s6h9wl7ym0k3xdhklm6ylcu4spjd9vv");

  const tx = await l.newTx()
  .payToAddress("addr1qxhwefhsv6xn2s4sn8a92f9m29lwj67aykn4plr9xal4r48del5pz2hf795j5wxzhzf405g377jmw7a92k9z2enhd6pqlal6jy", {
    ["lovelace"]: 250000000n
  }).complete();

  const signedTx = await tx.sign().complete();

  const txHash = await signedTx.submit();

  console.log(txHash);
  await l.awaitTx(txHash);
  console.log("Done");
}

// Address Details command
if (Deno.args.includes("--address-details")) {
  const address = Deno.args[Deno.args.indexOf("--address-details") + 1];
  const addressDetails = lucid.utils.getAddressDetails(address);
  console.log(addressDetails);
}