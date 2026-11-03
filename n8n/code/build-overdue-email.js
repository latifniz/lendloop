// Builds the overdue reminder for one borrower from the reminder item returned by Convex.
const reminder = $('Split reminders').item.json;

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const oneLine = (value) => String(value).replace(/[\r\n]+/g, ' ').trim();

const tool = oneLine(reminder.toolName);
const lender = oneLine(reminder.lenderName);
const days = reminder.daysOverdue === 1 ? '1 day' : reminder.daysOverdue + ' days';
const headline = tool + ' was due back on ' + reminder.dueDate + ' and is now ' + days + ' overdue.';
const next = 'Please return it to ' + lender + ' as soon as you can so they can confirm the return in LendLoop.';

return [
  {
    json: {
      to: reminder.borrower.email,
      subject: 'Reminder: please return ' + tool,
      text: 'Hi ' + oneLine(reminder.borrower.name) + ',\n\n' + headline + '\n\n' + next + '\n' + reminder.actionUrl +
        '\n\n- LendLoop',
      html: '<p>Hi ' + escapeHtml(oneLine(reminder.borrower.name)) + ',</p><p>' + escapeHtml(headline) + '</p><p>' +
        escapeHtml(next) + '</p><p><a href="' + escapeHtml(reminder.actionUrl) + '">Open LendLoop</a></p>',
    },
  },
];
