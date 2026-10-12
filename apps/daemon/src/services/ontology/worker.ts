import { parentPort, workerData } from 'node:worker_threads';
import { buildOntology, type OntologyJob } from './build.js';

if (!parentPort) throw new Error('Ontology analysis requires an isolated worker');
try { parentPort.postMessage({ result: await buildOntology(workerData as OntologyJob) }); }
catch (error) { parentPort.postMessage({ error: error instanceof Error ? error.message : 'Ontology analysis failed', status: Number((error as { status?: number })?.status) || 400 }); }
