const mongoose = require('mongoose');
const { Case, Entity, Edge } = require('./src/models');
mongoose.connect('mongodb://127.0.0.1:27017/sih_db_dev').then(async () => {
  const cases = await Case.find().sort({createdAt: -1}).limit(5);
  for (const c of cases) {
    const e = await Entity.find({ associatedCases: c.caseId });
    const edges = await Edge.find({ associatedCases: c.caseId });
    console.log('Case', c.caseId, e.length, 'entities', edges.length, 'edges');
  }
  process.exit(0);
}).catch(console.error);
