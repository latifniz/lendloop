// Builds the notification text for a request event. Pure formatting: no network, no secrets.
const payload = $('Verify signature').first().json.payload;

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const oneLine = (value) => String(value).replace(/[\r\n]+/g, ' ').trim();

const tool = oneLine(payload.tool.name);
const who = oneLine(payload.counterpartName);
const dates = payload.request.startDate + ' to ' + payload.request.endDate;

const templates = {
  'request.created': {
    subject: 'New borrow request for ' + tool,
    headline: who + ' would like to borrow ' + tool + ' (' + dates + ').',
    next: 'Review the request and approve or decline it.',
  },
  'request.approved': {
    subject: 'Your request for ' + tool + ' was approved',
    headline: 'Good news! ' + who + ' approved your request to borrow ' + tool + ' (' + dates + ').',
    next: 'Arrange the handover with the lender and return the tool by ' + payload.request.endDate + '.',
  },
  'request.declined': {
    subject: 'Your request for ' + tool + ' was declined',
    headline: who + ' declined your request to borrow ' + tool + ' (' + dates + ').',
    next: 'Browse other available tools or try different dates.',
  },
  'request.cancelled': {
    subject: who + ' cancelled their request for ' + tool,
    headline: who + ' cancelled their request to borrow ' + tool + ' (' + dates + ').',
    next: 'No action is needed.',
  },
};
const template = templates[payload.eventType];

const noteText = payload.request.message ? '\nTheir note: "' + payload.request.message + '"\n' : '';
const noteHtml = payload.request.message ? '<blockquote>' + escapeHtml(payload.request.message) + '</blockquote>' : '';

return [
  {
    json: {
      to: payload.recipient.email,
      subject: template.subject,
      text:
        'Hi ' + oneLine(payload.recipient.name) + ',\n\n' + template.headline + '\n' + noteText + '\n' +
        template.next + '\n' + payload.actionUrl + '\n\n- LendLoop: Borrow what you need. Lend what you don\'t.',
      html:
        '<p>Hi ' + escapeHtml(oneLine(payload.recipient.name)) + ',</p><p>' + escapeHtml(template.headline) + '</p>' +
        noteHtml + '<p>' + escapeHtml(template.next) + '</p><p><a href="' + escapeHtml(payload.actionUrl) + '">Open LendLoop</a></p>' +
        '<p style="color:#6b7280">LendLoop: Borrow what you need. Lend what you don\'t.</p>',
    },
  },
];
