/**
 * Demo data seeder:  npm run seed            (only seeds an empty database)
 *                    npm run seed -- --reset (drops the database first)
 *
 * Historical records (closed opportunities, past follow-ups) are inserted
 * directly as an authorised historical-entry process; everything created
 * through the application/API goes through the full business validation.
 */
const mongoose = require('mongoose');
const { connectDB } = require('../config/db');
const { ensureRoles } = require('./roles');
const { User, Role, Customer, Lead, Opportunity, FollowUp, Activity, AuditLog, Counter } = require('../models');
const pwd = require('../services/passwordService');
const { ROLES } = require('../config/constants');

const DEMO_PASSWORD = 'Acxiom@2026';
const day = 86400000;
const now = Date.now();
const d = (offsetDays, hour = 11) => { const x = new Date(now + offsetDays * day); x.setHours(hour, 0, 0, 0); return x; };
const pick = (arr, i) => arr[i % arr.length];

async function seed() {
  await connectDB();
  const reset = process.argv.includes('--reset');
  if (reset) {
    await mongoose.connection.dropDatabase();
    console.log('Database dropped.');
  } else if (await User.estimatedDocumentCount()) {
    console.log('Database already has users – skipping. Use "npm run seed -- --reset" to recreate demo data.');
    return mongoose.disconnect();
  }
  await Promise.all([Customer, Lead, Opportunity, FollowUp, Activity, AuditLog, User].map((m) => m.syncIndexes()));
  await ensureRoles();
  const roles = Object.fromEntries((await Role.find()).map((r) => [r.roleName, r._id]));
  const hash = await pwd.hash(DEMO_PASSWORD);

  const mk = (name, username, role, manager = null, phone = '') => User.create({
    name, username, email: `${username}@acxiomcrm.test`, phone, role: roles[role], manager, passwordHash: hash, passwordChangedAt: new Date(), isActive: true
  });
  const admin = await mk('Aarav Mehta', 'admin', ROLES.ADMIN, null, '9810000001');
  const m1 = await mk('Neha Sharma', 'neha.manager', ROLES.MANAGER, null, '9810000002');
  const m2 = await mk('Vikram Rao', 'vikram.manager', ROLES.MANAGER, null, '9810000003');
  const s1 = await mk('Rahul Verma', 'rahul.sales', ROLES.SALES, m1._id, '9810000004');
  const s2 = await mk('Priya Singh', 'priya.sales', ROLES.SALES, m1._id, '9810000005');
  const s3 = await mk('Amit Khan', 'amit.sales', ROLES.SALES, m2._id, '9810000006');
  const s4 = await mk('Sneha Iyer', 'sneha.sales', ROLES.SALES, m2._id, '9810000007');
  const sales = [s1, s2, s3, s4];

  // ---- Customers ----
  const companies = ['Tata Digital', 'Infosys BPM', 'Mahindra Logistics', 'Zomato Hyperpure', 'Godrej Properties', 'Asian Paints', 'Bharat Forge', 'Wipro GE', 'HDFC Ergo', 'Titan Retail', 'Dabur India', 'Lupin Labs', 'Havells', 'Nykaa Fashion', 'Ola Electric', 'Pidilite'];
  const people = ['Arjun Kapoor', 'Kavya Nair', 'Rohan Gupta', 'Ishita Bose', 'Siddharth Jain', 'Meera Pillai', 'Karan Malhotra', 'Ananya Das', 'Varun Reddy', 'Pooja Desai', 'Nikhil Joshi', 'Ritu Agarwal', 'Manish Tiwari', 'Sana Qureshi', 'Deepak Yadav', 'Tanvi Kulkarni'];
  const cities = [['Mumbai', 'Maharashtra'], ['Bengaluru', 'Karnataka'], ['Lucknow', 'Uttar Pradesh'], ['Pune', 'Maharashtra'], ['Hyderabad', 'Telangana'], ['Delhi', 'Delhi'], ['Chennai', 'Tamil Nadu'], ['Ahmedabad', 'Gujarat']];
  const customers = [];
  for (let i = 0; i < people.length; i++) {
    const owner = pick(sales, i);
    const [city, state] = pick(cities, i);
    const created = d(-200 + i * 11);
    customers.push(await Customer.create({
      customerCode: `CUST-${String(i + 1).padStart(5, '0')}`,
      customerName: people[i], email: `${people[i].toLowerCase().replace(/ /g, '.')}@${companies[i].toLowerCase().replace(/ /g, '')}.in`,
      phone: `98${String(20000000 + i * 137731).slice(0, 8)}`, companyName: companies[i],
      address: `${10 + i}, Business Park Road`, city, state, status: i % 7 === 6 ? 'Inactive' : i % 5 === 4 ? 'Prospect' : 'Active',
      owner: owner._id, notes: '', createdBy: owner._id, createdDate: created, modifiedDate: created,
      history: [{ action: 'Created', to: 'Active', by: owner._id, at: created }]
    }));
  }
  await Counter.updateOne({ _id: 'customer' }, { $set: { seq: customers.length } }, { upsert: true });

  // ---- Leads ----
  const leadNames = ['Aditya Bhatt', 'Simran Kaur', 'Harsh Vardhan', 'Neelam Chauhan', 'Yash Patil', 'Bhavna Rawat', 'Kunal Shah', 'Divya Menon', 'Gaurav Saxena', 'Shreya Ghosh', 'Mohit Arora', 'Pallavi Mishra', 'Rajat Sinha', 'Aisha Siddiqui', 'Tarun Bansal', 'Nisha Pandey', 'Akash Dubey', 'Rekha Iyer', 'Sameer Ali', 'Kritika Sood'];
  const leadCompanies = ['FreshCart', 'UrbanNest', 'MedPlus Labs', 'GreenGrid Solar', 'QuickShip', 'EduSpark', 'FinEdge', 'CloudKitchenz', 'AutoNova', 'BrightSmile Dental', 'SkyHigh Realty', 'AgroFresh', 'NovaPharma', 'Craftly', 'SwiftPay', 'HomeBoost', 'TechTrek', 'WellnessHub', 'BuildMax', 'StyleStreet'];
  const statuses = ['New', 'New', 'Contacted', 'Contacted', 'Qualified', 'Qualified', 'Unqualified', 'Lost', 'Converted', 'New'];
  const sources = ['Website', 'Referral', 'Social Media', 'Email Campaign', 'Cold Call', 'Trade Show', 'Advertisement'];
  const leads = [];
  for (let i = 0; i < leadNames.length; i++) {
    const owner = pick(sales, i + 1);
    const status = pick(statuses, i);
    const created = d(-150 + i * 7);
    leads.push(await Lead.create({
      leadCode: `LEAD-${String(i + 1).padStart(5, '0')}`, leadName: leadNames[i],
      email: `${leadNames[i].split(' ')[0].toLowerCase()}@${leadCompanies[i].toLowerCase()}.com`, phone: `97${String(30000000 + i * 271103).slice(0, 8)}`,
      companyName: leadCompanies[i], source: pick(sources, i), status, priority: pick(['High', 'Medium', 'Low'], i),
      expectedValue: 50000 + ((i * 37) % 20) * 25000, assignedTo: owner._id, createdBy: owner._id, createdDate: created, modifiedDate: created,
      convertedAt: status === 'Converted' ? d(-150 + i * 7 + 5) : null, convertedBy: status === 'Converted' ? owner._id : null,
      convertedCustomer: status === 'Converted' ? customers[i % customers.length]._id : null,
      history: [{ action: 'Created', to: 'New', by: owner._id, at: created }, ...(status !== 'New' ? [{ action: 'StatusChange', from: 'New', to: status, by: owner._id, at: d(-150 + i * 7 + 3) }] : [])]
    }));
  }
  await Counter.updateOne({ _id: 'lead' }, { $set: { seq: leads.length } }, { upsert: true });

  // ---- Opportunities ----
  const oppDefs = [
    ['ERP Implementation', 'Negotiation', 1850000, 75, 20], ['Cloud Migration', 'Proposal', 920000, 50, 35], ['CRM Licences – 150 seats', 'Qualification', 450000, 20, 45],
    ['Data Analytics Platform', 'Proposal', 1300000, 55, 28], ['Annual Support Contract', 'Negotiation', 380000, 80, 12], ['Mobile App Development', 'Qualification', 760000, 25, 60],
    ['Warehouse Automation', 'Won', 2400000, 100, -150], ['Security Audit', 'Won', 310000, 100, -110], ['HRMS Rollout', 'Lost', 640000, 0, -95],
    ['E-commerce Revamp', 'Won', 1150000, 100, -70], ['IoT Fleet Tracking', 'Lost', 980000, 0, -45], ['Payroll Outsourcing', 'Won', 520000, 100, -30],
    ['AI Chatbot Pilot', 'Won', 270000, 100, -12], ['Network Upgrade', 'Proposal', 830000, 45, 40], ['Digital Marketing Retainer', 'Qualification', 240000, 20, 75],
    ['Document Management', 'Lost', 410000, 0, -20], ['BI Dashboards', 'Negotiation', 690000, 70, 18], ['Training Programme', 'Won', 190000, 100, -5]
  ];
  const opps = [];
  for (let i = 0; i < oppDefs.length; i++) {
    const [name, stage, amount, probability, closeOffset] = oppDefs[i];
    const customer = customers[i % customers.length];
    const owner = sales.find((s) => String(s._id) === String(customer.owner));
    const closed = ['Won', 'Lost'].includes(stage);
    const created = d(closeOffset - 60);
    opps.push(await Opportunity.create({
      opportunityCode: `OPP-${String(i + 1).padStart(5, '0')}`, opportunityName: name, customer: customer._id,
      amount, stage, probability, expectedCloseDate: d(closeOffset), status: closed ? stage : 'Open', source: pick(sources, i),
      assignedTo: owner._id, createdBy: owner._id, closedDate: closed ? d(closeOffset) : null,
      outcomeReason: stage === 'Lost' ? pick(['Lost to competitor on price', 'Budget frozen', 'Project postponed'], i) : stage === 'Won' ? 'Signed contract' : '',
      createdDate: created, modifiedDate: closed ? d(closeOffset) : created,
      history: [{ action: 'Created', to: 'Qualification', by: owner._id, at: created }, ...(stage !== 'Qualification' ? [{ action: closed ? `Marked ${stage}` : 'StageChange', from: 'Qualification', to: stage, by: owner._id, at: closed ? d(closeOffset) : created }] : [])]
    }));
  }
  await Counter.updateOne({ _id: 'opportunity' }, { $set: { seq: opps.length } }, { upsert: true });

  // ---- Follow-ups ----
  const fuDefs = [
    ['Demo walkthrough', 'Meeting', 1, 'Planned'], ['Send revised quotation', 'Email', 2, 'Planned'], ['Pricing discussion call', 'Call', 0, 'Planned'],
    ['Contract review', 'Meeting', 5, 'Planned'], ['Check decision timeline', 'Call', -2, 'Planned'], ['Share case studies', 'Email', -1, 'Planned'],
    ['Site visit', 'Visit', -6, 'Completed'], ['Requirement gathering', 'Meeting', -10, 'Completed'], ['Intro call', 'Call', -4, 'Missed'],
    ['Follow up on proposal', 'Call', 7, 'Planned'], ['Budget confirmation', 'Email', 3, 'Planned'], ['Kick-off planning', 'Task', -15, 'Cancelled']
  ];
  for (let i = 0; i < fuDefs.length; i++) {
    const [subject, type, offset, status] = fuDefs[i];
    let rel;
    if (i % 3 === 0) { const o = opps[i % 6]; rel = { relatedType: 'Opportunity', relatedId: o._id, opportunity: o._id, customer: o.customer, assignedTo: o.assignedTo }; }
    else if (i % 3 === 1) { const c = customers[i]; rel = { relatedType: 'Customer', relatedId: c._id, customer: c._id, assignedTo: c.owner }; }
    else { const l = leads[[0, 1, 2, 3, 4, 5][i % 6]]; rel = { relatedType: 'Lead', relatedId: l._id, lead: l._id, assignedTo: l.assignedTo }; }
    await FollowUp.create({
      subject, followUpType: type, followUpDate: d(offset, 10 + (i % 6)), status, remarks: '', ...rel, createdBy: rel.assignedTo,
      outcome: status === 'Completed' ? 'Client confirmed interest; next step agreed.' : '', completedAt: status === 'Completed' ? d(offset, 15) : null,
      history: [{ action: 'Scheduled', to: 'Planned', by: rel.assignedTo, at: d(offset - 7) }, ...(status !== 'Planned' ? [{ action: status, from: 'Planned', to: status, by: rel.assignedTo, at: d(offset, 16) }] : [])]
    });
  }

  // ---- Activities ----
  const actTypes = ['Call', 'Meeting', 'Email', 'Task'];
  for (let i = 0; i < 16; i++) {
    const c = customers[i % customers.length];
    await Activity.create({
      activityType: pick(actTypes, i), subject: pick(['Discovery call', 'Product demo', 'Sent brochure', 'Prepare proposal', 'Quarterly review', 'Negotiation meeting'], i),
      description: 'Logged during demo data setup.', activityDate: d(-i * 3, 12), status: i % 5 === 0 ? 'Planned' : 'Completed',
      customer: c._id, assignedTo: c.owner, createdBy: c.owner
    });
  }

  await AuditLog.create({ user: admin._id, userName: `${admin.name} (${admin.username})`, action: 'Create', entityName: 'System', details: 'Demo data seeded', ipAddress: '127.0.0.1' });

  console.log('\nDemo data created. All demo users share the password:', DEMO_PASSWORD);
  console.table([admin, m1, m2, ...sales].map((u) => ({ username: u.username, email: u.email, role: Object.keys(roles).find((k) => String(roles[k]) === String(u.role)) })));
  await mongoose.disconnect();
}

seed().catch(async (e) => { console.error(e); await mongoose.disconnect(); process.exit(1); });
