/** Offline/quiescent local database snapshot. No live-consistency claim. No overwrite restore. */
import mongoose from 'mongoose';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, lstat, realpath, rm } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip, createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
type Db = ReturnType<InstanceType<typeof mongoose.mongo.MongoClient>['db']>;
const EJSON = mongoose.mongo.BSON.EJSON;
const hash = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const databaseName = (db: Db) => { if (!/^s7_(?:fictional|restore_test)_[a-f0-9]{12}$/.test(db.databaseName))
    throw Error('rehearsal_database_required'); };
async function privateFile(path: string) { const stat = await lstat(path); if (!stat.isFile() || stat.isSymbolicLink())
    throw Error('unsafe_file'); return realpath(path); }
async function checkIdle(db: Db) { for (const [collection, field] of [['knowledgeparsings', 'state'], ['knowledgeindexgenerations', 'state'], ['agenttasks', 'status']])
    if (await db.collection(collection).countDocuments({ [field]: { $in: ['queued', 'running'] } }, { limit: 1 }))
        throw Error('active_jobs'); }
async function fingerprint(db: Db) { const out = []; for (const c of (await db.listCollections({}, { nameOnly: false }).toArray()).sort((a, b) => a.name.localeCompare(b.name))) {
    if (c.type !== 'collection' || c.name.startsWith('system.'))
        throw Error('unsupported_collection');
    const h = createHash('sha256');
    let count = 0;
    for await (const row of db.collection(c.name).find({}).sort({ _id: 1 })) {
        h.update(EJSON.stringify(row, { relaxed: false }));
        count++;
    }
    out.push({ name: c.name, count, digest: h.digest('hex') });
} return out; }
export async function snapshotDatabase(db: Db, destination: string, keyFile: string, options: {
    acknowledgeAllWritersStopped: boolean;
    configurationFiles: string[];
}) {
    databaseName(db);
    if (!options.acknowledgeAllWritersStopped)
        throw Error('quiescence_required');
    await checkIdle(db);
    const keyPath = await privateFile(keyFile), key = await readFile(keyPath);
    if (key.length !== 32)
        throw Error('key_length');
    destination = resolve(destination);
    const parent = await realpath(dirname(destination));
    if (resolve(parent, require('node:path').basename(destination)) !== destination)
        throw Error('unsafe_destination');
    // Dedicated new directory only; no recursive overwrite or following links.
    if (keyPath.startsWith(destination + require('node:path').sep))
        throw Error('key_must_be_separate');
    await mkdir(destination, { mode: 0o700 });
    let complete = false;
    try {
        const before = await fingerprint(db), iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv), encryptedHash = createHash('sha256');
        let bytes = 0, records = 0;
        async function* recordsStream() { for (const c of before) {
            yield Buffer.from(JSON.stringify({ type: 'collection', name: c.name, indexes: await db.collection(c.name).indexes() }) + '\n');
            for await (const doc of db.collection(c.name).find({}).sort({ _id: 1 })) {
                if (++records > 1000000)
                    throw Error('snapshot_record_limit');
                const line = EJSON.stringify({ type: 'document', collection: c.name, doc }, { relaxed: false }) + '\n';
                bytes += Buffer.byteLength(line);
                if (bytes > 4 * 1024 ** 3 || Buffer.byteLength(line) > 32 * 1024 ** 2)
                    throw Error('snapshot_size_limit');
                yield Buffer.from(line);
            }
        } }
        await pipeline(Readable.from(recordsStream()), createGzip(), cipher, new Transform({ transform(part, _encoding, done) { encryptedHash.update(part); done(null, part); } }), createWriteStream(join(destination, 'database.aesgcm'), { flags: 'wx', mode: 0o600 }));
        const after = await fingerprint(db);
        if (JSON.stringify(before) !== JSON.stringify(after))
            throw Error('source_changed');
        await checkIdle(db);
        const configs = [];
        for (const file of options.configurationFiles) {
            const name = require('node:path').basename(file);
            if (!['model.json', 'reranker.json', 'requirements.lock', 'parser_process.py', 'runtime.py', 'retrieval.py'].includes(name))
                throw Error('configuration_not_allowlisted');
            const data = await readFile(await privateFile(file));
            if (data.length > 1024 ** 2)
                throw Error('configuration_limit');
            configs.push({ name, digest: hash(data), content: data.toString('base64') });
        }
        const manifest = { version: 1, mode: 'quiescent-rehearsal', createdAt: new Date().toISOString(), collections: before, records, uncompressedBytes: bytes, iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), encryptedDigest: encryptedHash.digest('hex'), configurations: configs, derivedIndex: 'rebuild_from_authoritative_mongo' };
        await writeFile(join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
        complete = true;
        return { records, collections: before.length, bytes, configurations: configs.length };
    }
    finally {
        key.fill(0);
        if (!complete)
            await writeFile(join(destination, 'INCOMPLETE'), 'Do not restore this incomplete snapshot', { flag: 'wx' }).catch(() => undefined);
    }
}
export async function restoreDatabase(db: Db, source: string, keyFile: string) {
    databaseName(db);
    if (!db.databaseName.startsWith('s7_restore_test_'))
        throw Error('fresh_restore_database_required');
    if ((await db.listCollections().toArray()).length)
        throw Error('target_not_empty');
    source = await realpath(source);
    const manifest = JSON.parse(await readFile(await privateFile(join(source, 'manifest.json')), 'utf8'));
    if (!Array.isArray(manifest.configurations) || manifest.configurations.some((c: {
        content: string;
        digest: string;
    }) => hash(Buffer.from(c.content, 'base64')) !== c.digest))
        throw Error('configuration_corrupt');
    if (manifest.version !== 1 || manifest.mode !== 'quiescent-rehearsal' || !Array.isArray(manifest.collections) || manifest.collections.length > 1000)
        throw Error('invalid_manifest');
    const key = await readFile(await privateFile(keyFile));
    if (key.length !== 32)
        throw Error('key_length');
    const file = await privateFile(join(source, 'database.aesgcm'));
    const digest = createHash('sha256');
    for await (const part of createReadStream(file))
        digest.update(part);
    if (digest.digest('hex') !== manifest.encryptedDigest) {
        key.fill(0);
        throw Error('snapshot_corrupt');
    }
    const temp = join(source, 'verified-' + randomBytes(8).toString('hex') + '.tmp');
    let created = false;
    try {
        const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(manifest.iv, 'hex'));
        decipher.setAuthTag(Buffer.from(manifest.tag, 'hex'));
        let size = 0;
        // Authenticate/decompress completely BEFORE first DB write; bounded disk size.
        created = true;
        await pipeline(createReadStream(file), decipher, createGunzip(), new Transform({ transform(part, _encoding, done) { size += part.length; done(size > 4 * 1024 ** 3 ? Error('restore_size_limit') : null, part); } }), createWriteStream(temp, { flags: 'wx', mode: 0o600 }));
        const known = new Set(manifest.collections.map((c: {
            name: string;
        }) => c.name));
        for (const name of known)
            if (typeof name !== 'string' || !/^[a-z][a-z0-9_]{0,100}$/.test(name))
                throw Error('invalid_collection');
        // Validate envelope/record structure, digest and count before making target visible.
        const hashes = new Map<string, ReturnType<typeof createHash>>(), counts = new Map<string, number>(), indexes = new Map<string, Record<string, unknown>[]>();
        for await (const line of createInterface({ input: createReadStream(temp), crlfDelay: Infinity })) {
            if (Buffer.byteLength(line) > 32 * 1024 ** 2)
                throw Error('record_limit');
            const row = EJSON.parse(line, { relaxed: false });
            if (row.type === 'collection') {
                if (!known.has(row.name) || hashes.has(row.name) || !Array.isArray(row.indexes))
                    throw Error('invalid_collection');
                hashes.set(row.name, createHash('sha256'));
                counts.set(row.name, 0);
                indexes.set(row.name, row.indexes);
            }
            else if (row.type === 'document' && hashes.has(row.collection) && row.doc && row.doc._id) {
                hashes.get(row.collection)!.update(EJSON.stringify(row.doc, { relaxed: false }));
                counts.set(row.collection, counts.get(row.collection)! + 1);
            }
            else
                throw Error('invalid_record');
        }
        for (const c of manifest.collections)
            if (counts.get(c.name) !== c.count || hashes.get(c.name)?.digest('hex') !== c.digest)
                throw Error('manifest_mismatch');
        for (const name of known as Set<string>)
            await db.createCollection(name);
        for await (const line of createInterface({ input: createReadStream(temp), crlfDelay: Infinity })) {
            const row = EJSON.parse(line, { relaxed: false });
            if (row.type === 'document')
                await db.collection(row.collection).insertOne(row.doc);
        }
        for (const [name, all] of indexes)
            for (const index of all) {
                if (index.name === '_id_')
                    continue;
                const { v, ns, key, ...options } = index;
                await db.collection(name).createIndex(key as Record<string, 1 | -1>, options);
            }
        const restored = await fingerprint(db);
        if (JSON.stringify(restored) !== JSON.stringify(manifest.collections))
            throw Error('restored_hash_mismatch');
        return { records: manifest.records, collections: restored.length, verified: true, configurationHashes: manifest.configurations.map((c: {
                name: string;
                digest: string;
            }) => ({ name: c.name, digest: c.digest })), indexRebuildRequired: true };
    }
    finally {
        key.fill(0);
        if (created)
            await rm(temp, { force: true });
    }
}
export async function createSnapshotKey(path: string) { await writeFile(path, randomBytes(32), { flag: 'wx', mode: 0o600 }); }
