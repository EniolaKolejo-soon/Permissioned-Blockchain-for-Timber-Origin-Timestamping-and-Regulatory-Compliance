// timber-batch.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { stringUtf8CV, uintCV, intCV, bufferCV } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_INVALID_LAT = 101;
const ERR_INVALID_LON = 102;
const ERR_INVALID_VOLUME = 103;
const ERR_INVALID_SPECIES = 104;
const ERR_INVALID_TIMESTAMP_HASH = 105;
const ERR_BATCH_ALREADY_EXISTS = 106;
const ERR_BATCH_NOT_FOUND = 107;
const ERR_INVALID_BURNER = 108;
const ERR_MAX_BATCHES_EXCEEDED = 109;
const ERR_INVALID_MINT_FEE = 110;
const ERR_ORACLE_NOT_VERIFIED = 111;
const ERR_INVALID_GPS = 112;
const ERR_INVALID_TIMESTAMP = 113;

interface Batch {
  lat: number;
  lon: number;
  species: string;
  volume: bigint;
  timestampHash: Buffer;
  mintTimestamp: number;
  owner: string;
  status: boolean;
  gpsVerified: boolean;
  oracleVerified: boolean;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

interface OracleVerifyResult {
  value: boolean;
}

class TimberBatchMock {
  state: {
    nextBatchId: number;
    maxBatches: number;
    mintFee: number;
    authorityContract: string | null;
    oracleContract: string | null;
    batches: Map<number, Batch>;
    batchOwners: Map<number, string>;
    ownerBatchCount: Map<string, number>;
  } = {
    nextBatchId: 0,
    maxBatches: 5000,
    mintFee: 500,
    authorityContract: null,
    oracleContract: null,
    batches: new Map(),
    batchOwners: new Map(),
    ownerBatchCount: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1LOGGER";
  stxTransfers: Array<{ amount: number; from: string; to: string | null }> = [];

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      nextBatchId: 0,
      maxBatches: 5000,
      mintFee: 500,
      authorityContract: null,
      oracleContract: null,
      batches: new Map(),
      batchOwners: new Map(),
      ownerBatchCount: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1LOGGER";
    this.stxTransfers = [];
  }

  setAuthorityContract(contractPrincipal: string): Result<boolean> {
    if (this.state.authorityContract !== null) {
      return { ok: false, value: false };
    }
    this.state.authorityContract = contractPrincipal;
    return { ok: true, value: true };
  }

  setOracleContract(contractPrincipal: string): Result<boolean> {
    if (!this.state.authorityContract) {
      return { ok: false, value: false };
    }
    this.state.oracleContract = contractPrincipal;
    return { ok: true, value: true };
  }

  setMaxBatches(newMax: number): Result<boolean> {
    if (!this.state.authorityContract) {
      return { ok: false, value: false };
    }
    if (newMax <= 0) {
      return { ok: false, value: false };
    }
    this.state.maxBatches = newMax;
    return { ok: true, value: true };
  }

  setMintFee(newFee: number): Result<boolean> {
    if (!this.state.authorityContract) {
      return { ok: false, value: false };
    }
    if (newFee < 0) {
      return { ok: false, value: false };
    }
    this.state.mintFee = newFee;
    return { ok: true, value: true };
  }

  isLogger(caller: string): boolean {
    return caller === "ST1LOGGER";
  }

  isRegulator(caller: string): boolean {
    return caller === "ST1REGULATOR";
  }

  verifyTimestamp(hash: Buffer, ts: number): Result<OracleVerifyResult> {
    if (this.state.oracleContract) {
      return { ok: true, value: { value: ts >= this.blockHeight } };
    }
    return { ok: true, value: { value: false } };
  }

  getBatch(id: number): Batch | null {
    return this.state.batches.get(id) || null;
  }

  getBatchOwner(id: number): string | null {
    return this.state.batchOwners.get(id) || null;
  }

  getOwnerBatchCount(owner: string): number {
    return this.state.ownerBatchCount.get(owner) || 0;
  }

  isBatchMinted(id: number): boolean {
    return this.state.batches.has(id);
  }

  mintBatch(
    batchId: number,
    lat: number,
    lon: number,
    species: string,
    volume: bigint,
    timestampHash: Buffer,
    mintTs: number
  ): Result<number> {
    if (batchId !== this.state.nextBatchId) {
      return { ok: false, value: ERR_BATCH_ALREADY_EXISTS };
    }
    if (this.state.nextBatchId >= this.state.maxBatches) {
      return { ok: false, value: ERR_MAX_BATCHES_EXCEEDED };
    }
    if (!this.isLogger(this.caller)) {
      return { ok: false, value: ERR_NOT_AUTHORIZED };
    }
    if (lat < -90 || lat > 90) {
      return { ok: false, value: ERR_INVALID_LAT };
    }
    if (lon < -180 || lon > 180) {
      return { ok: false, value: ERR_INVALID_LON };
    }
    if (Number(volume) <= 0) {
      return { ok: false, value: ERR_INVALID_VOLUME };
    }
    const validSpecies = ["Oak", "Pine", "Maple", "Birch", "Cedar", "Fir"];
    if (!validSpecies.includes(species) || species.length > 50) {
      return { ok: false, value: ERR_INVALID_SPECIES };
    }
    if (timestampHash.length !== 32) {
      return { ok: false, value: ERR_INVALID_TIMESTAMP_HASH };
    }
    if (mintTs < this.blockHeight) {
      return { ok: false, value: ERR_INVALID_TIMESTAMP };
    }
    if (!this.state.authorityContract) {
      return { ok: false, value: ERR_ORACLE_NOT_VERIFIED };
    }
    this.stxTransfers.push({ amount: this.state.mintFee, from: this.caller, to: this.state.authorityContract });
    const oracleRes = this.verifyTimestamp(timestampHash, mintTs);
    const batch: Batch = {
      lat,
      lon,
      species,
      volume,
      timestampHash,
      mintTimestamp: mintTs,
      owner: this.caller,
      status: true,
      gpsVerified: true,
      oracleVerified: oracleRes.value.value,
    };
    this.state.batches.set(this.state.nextBatchId, batch);
    this.state.batchOwners.set(this.state.nextBatchId, this.caller);
    this.state.ownerBatchCount.set(this.caller, (this.getOwnerBatchCount(this.caller) + 1));
    this.state.nextBatchId++;
    return { ok: true, value: this.state.nextBatchId - 1 };
  }

  burnBatch(batchId: number): Result<boolean> {
    const batch = this.getBatch(batchId);
    const owner = this.getBatchOwner(batchId);
    if (!batch || !owner) {
      return { ok: false, value: ERR_BATCH_NOT_FOUND };
    }
    if (!batch.status) {
      return { ok: false, value: ERR_BATCH_NOT_FOUND };
    }
    const isBurner = this.caller === owner || this.isRegulator(this.caller);
    if (!isBurner) {
      return { ok: false, value: ERR_INVALID_BURNER };
    }
    const updatedBatch: Batch = { ...batch, status: false };
    this.state.batches.set(batchId, updatedBatch);
    this.state.batchOwners.delete(batchId);
    this.state.ownerBatchCount.set(owner, this.getOwnerBatchCount(owner) - 1);
    return { ok: true, value: true };
  }

  transferBatch(batchId: number, newOwner: string): Result<boolean> {
    const batch = this.getBatch(batchId);
    const currentOwner = this.getBatchOwner(batchId);
    if (!batch || !currentOwner) {
      return { ok: false, value: ERR_BATCH_NOT_FOUND };
    }
    if (this.caller !== currentOwner) {
      return { ok: false, value: ERR_NOT_AUTHORIZED };
    }
    if (!batch.status) {
      return { ok: false, value: ERR_BATCH_NOT_FOUND };
    }
    const updatedBatch: Batch = { ...batch, owner: newOwner };
    this.state.batches.set(batchId, updatedBatch);
    this.state.batchOwners.set(batchId, newOwner);
    this.state.ownerBatchCount.set(currentOwner, this.getOwnerBatchCount(currentOwner) - 1);
    this.state.ownerBatchCount.set(newOwner, this.getOwnerBatchCount(newOwner) + 1);
    return { ok: true, value: true };
  }

  getBatchCount(): Result<number> {
    return { ok: true, value: this.state.nextBatchId };
  }
}

describe("TimberBatch", () => {
  let contract: TimberBatchMock;

  beforeEach(() => {
    contract = new TimberBatchMock();
    contract.reset();
  });

  it("mints a batch successfully without oracle", () => {
    contract.setAuthorityContract("ST2AUTH");
    const hash = Buffer.from("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", "hex");
    const result = contract.mintBatch(
      0,
      40.7128,
      -74.0060,
      "Oak",
      BigInt(1000),
      hash,
      100
    );
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0);
    const batch = contract.getBatch(0);
    expect(batch?.lat).toBe(40.7128);
    expect(batch?.lon).toBe(-74.0060);
    expect(batch?.species).toBe("Oak");
    expect(batch?.volume).toBe(BigInt(1000));
    expect(batch?.timestampHash).toEqual(hash);
    expect(batch?.mintTimestamp).toBe(100);
    expect(batch?.owner).toBe("ST1LOGGER");
    expect(batch?.status).toBe(true);
    expect(batch?.gpsVerified).toBe(true);
    expect(batch?.oracleVerified).toBe(false);
    expect(contract.stxTransfers).toEqual([{ amount: 500, from: "ST1LOGGER", to: "ST2AUTH" }]);
  });

  it("mints a batch successfully with oracle verification", () => {
    contract.setAuthorityContract("ST2AUTH");
    contract.setOracleContract("ST3ORACLE");
    contract.blockHeight = 50;
    const hash = Buffer.from("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", "hex");
    const result = contract.mintBatch(
      0,
      40.7128,
      -74.0060,
      "Pine",
      BigInt(2000),
      hash,
      60
    );
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0);
    const batch = contract.getBatch(0);
    expect(batch?.oracleVerified).toBe(true);
  });

  it("rejects invalid latitude", () => {
    contract.setAuthorityContract("ST2AUTH");
    const hash = Buffer.alloc(32);
    const result = contract.mintBatch(
      0,
      100,
      -74.0060,
      "Oak",
      BigInt(1000),
      hash,
      100
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_LAT);
  });

  it("rejects invalid longitude", () => {
    contract.setAuthorityContract("ST2AUTH");
    const hash = Buffer.alloc(32);
    const result = contract.mintBatch(
      0,
      40.7128,
      200,
      "Oak",
      BigInt(1000),
      hash,
      100
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_LON);
  });

  it("rejects invalid volume", () => {
    contract.setAuthorityContract("ST2AUTH");
    const hash = Buffer.alloc(32);
    const result = contract.mintBatch(
      0,
      40.7128,
      -74.0060,
      "Oak",
      BigInt(0),
      hash,
      100
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_VOLUME);
  });

  it("rejects invalid species", () => {
    contract.setAuthorityContract("ST2AUTH");
    const hash = Buffer.alloc(32);
    const result = contract.mintBatch(
      0,
      40.7128,
      -74.0060,
      "InvalidTree",
      BigInt(1000),
      hash,
      100
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_SPECIES);
  });

  it("rejects invalid timestamp hash length", () => {
    contract.setAuthorityContract("ST2AUTH");
    const hash = Buffer.alloc(31);
    const result = contract.mintBatch(
      0,
      40.7128,
      -74.0060,
      "Oak",
      BigInt(1000),
      hash,
      100
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_TIMESTAMP_HASH);
  });

  it("rejects past timestamp", () => {
    contract.blockHeight = 100;
    contract.setAuthorityContract("ST2AUTH");
    const hash = Buffer.alloc(32);
    const result = contract.mintBatch(
      0,
      40.7128,
      -74.0060,
      "Oak",
      BigInt(1000),
      hash,
      50
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_TIMESTAMP);
  });

  it("rejects mint without authority", () => {
    const hash = Buffer.alloc(32);
    const result = contract.mintBatch(
      0,
      40.7128,
      -74.0060,
      "Oak",
      BigInt(1000),
      hash,
      100
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_ORACLE_NOT_VERIFIED);
  });

  it("rejects non-logger mint", () => {
    contract.setAuthorityContract("ST2AUTH");
    contract.caller = "ST2FAKE";
    const hash = Buffer.alloc(32);
    const result = contract.mintBatch(
      0,
      40.7128,
      -74.0060,
      "Oak",
      BigInt(1000),
      hash,
      100
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("burns a batch successfully by owner", () => {
    contract.setAuthorityContract("ST2AUTH");
    const hash = Buffer.alloc(32);
    contract.mintBatch(0, 40.7128, -74.0060, "Oak", BigInt(1000), hash, 100);
    const result = contract.burnBatch(0);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const batch = contract.getBatch(0);
    expect(batch?.status).toBe(false);
    expect(contract.getBatchOwner(0)).toBeNull();
    expect(contract.getOwnerBatchCount("ST1LOGGER")).toBe(0);
  });

  it("burns a batch successfully by regulator", () => {
    contract.setAuthorityContract("ST2AUTH");
    const hash = Buffer.alloc(32);
    contract.mintBatch(0, 40.7128, -74.0060, "Oak", BigInt(1000), hash, 100);
    contract.caller = "ST1REGULATOR";
    const result = contract.burnBatch(0);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
  });

  it("rejects burn of non-existent batch", () => {
    const result = contract.burnBatch(999);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_BATCH_NOT_FOUND);
  });

  it("rejects burn by unauthorized", () => {
    contract.setAuthorityContract("ST2AUTH");
    const hash = Buffer.alloc(32);
    contract.mintBatch(0, 40.7128, -74.0060, "Oak", BigInt(1000), hash, 100);
    contract.caller = "ST2FAKE";
    const result = contract.burnBatch(0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_BURNER);
  });

  it("transfers a batch successfully", () => {
    contract.setAuthorityContract("ST2AUTH");
    const hash = Buffer.alloc(32);
    contract.mintBatch(0, 40.7128, -74.0060, "Oak", BigInt(1000), hash, 100);
    const result = contract.transferBatch(0, "ST2MILL");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.getBatchOwner(0)).toBe("ST2MILL");
    expect(contract.getOwnerBatchCount("ST1LOGGER")).toBe(0);
    expect(contract.getOwnerBatchCount("ST2MILL")).toBe(1);
  });

  it("rejects transfer by non-owner", () => {
    contract.setAuthorityContract("ST2AUTH");
    const hash = Buffer.alloc(32);
    contract.mintBatch(0, 40.7128, -74.0060, "Oak", BigInt(1000), hash, 100);
    contract.caller = "ST2FAKE";
    const result = contract.transferBatch(0, "ST2MILL");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("returns correct batch count", () => {
    contract.setAuthorityContract("ST2AUTH");
    const hash = Buffer.alloc(32);
    contract.mintBatch(0, 40.7128, -74.0060, "Oak", BigInt(1000), hash, 100);
    contract.mintBatch(1, 51.5074, -0.1278, "Pine", BigInt(1500), hash, 101);
    const result = contract.getBatchCount();
    expect(result.ok).toBe(true);
    expect(result.value).toBe(2);
  });

  it("rejects max batches exceeded", () => {
    contract.setAuthorityContract("ST2AUTH");
    contract.state.maxBatches = 1;
    const hash = Buffer.alloc(32);
    contract.mintBatch(0, 40.7128, -74.0060, "Oak", BigInt(1000), hash, 100);
    const result = contract.mintBatch(1, 51.5074, -0.1278, "Pine", BigInt(1500), hash, 101);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_MAX_BATCHES_EXCEEDED);
  });

  it("sets mint fee and uses it", () => {
    contract.setAuthorityContract("ST2AUTH");
    contract.setMintFee(1000);
    const hash = Buffer.alloc(32);
    contract.mintBatch(0, 40.7128, -74.0060, "Oak", BigInt(1000), hash, 100);
    expect(contract.stxTransfers).toEqual([{ amount: 1000, from: "ST1LOGGER", to: "ST2AUTH" }]);
  });
});