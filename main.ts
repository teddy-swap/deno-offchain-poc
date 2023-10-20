// deno-lint-ignore-file no-explicit-any
import { Blockfrost, Lucid } from "https://deno.land/x/lucid@0.10.7/mod.ts"
import { config } from "https://deno.land/x/dotenv@v3.2.2/mod.ts";
import { burnAdaPoolTokenSetAsync, createMintPolicyWithAddress, getPolicyId, mintAdaPoolTokenSetAsync } from "./asset.ts";
import { createAdaPool, depositValidatorAddress } from "./validator.ts";

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

if(Deno.args.includes("--burn-pool-token")) {
  const token = Deno.args[Deno.args.indexOf("--burn-pool-token") + 1];
  console.log(`Burning ${token} Pool Token Set`);
  await burnAdaPoolTokenSetAsync(lucid, changeAddr, token);
  // Remove the pool token json file
  await Deno.remove(`pools/${token}_pool.json`);
}

if(Deno.args.includes("--create-pool")) {
  const token = Deno.args[Deno.args.indexOf("--create-pool") + 1];
  console.log(`Creating ${token} Pool`);
  const data = await Deno.readFile(`pools/${token}_pool.json`);
  const poolTokenSet = fromJson(new TextDecoder().decode(data));
  const poolAddr = depositValidatorAddress(lucid);
  const txHash = await createAdaPool(lucid, poolTokenSet, changeAddr, poolAddr, adminPolicyId);
  console.log(`Created ${token} Pool`, txHash);
}
