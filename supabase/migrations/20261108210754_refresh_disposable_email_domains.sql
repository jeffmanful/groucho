-- Pinned disposable-only snapshot:
-- https://github.com/disposable/disposable-email-domains/tree/1fa3c67aaaa1c135779d020515e2fb4d88ec2dc6
-- Select DNS-valid domains attributed directly to AdGuardTempMail, Boomlify,
-- Dustmail, FiveMinMail, Tempamail, TempMailOrg, TempmailNinja, TenMinutesEmail
-- and TestinatorEmail in the upstream source map, plus mail.tm. Retain the
-- existing seed and project dismissals. Apple privacy relays are informational.
--
-- MIT License
--
-- Copyright (c) 2017 Andrei Simionescu
-- Copyright (c) 2017 Stefan Meinecke, greenSec GmbH
--
-- Permission is hereby granted, free of charge, to any person obtaining a copy
-- of this software and associated documentation files (the "Software"), to deal
-- in the Software without restriction, including without limitation the rights
-- to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
-- copies of the Software, and to permit persons to whom the Software is
-- furnished to do so, subject to the following conditions:
--
-- The above copyright notice and this permission notice shall be included in all
-- copies or substantial portions of the Software.
--
-- THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
-- IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
-- FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
-- AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
-- LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
-- OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
-- SOFTWARE.

INSERT INTO public.disposable_email_domains (domain) VALUES
  ('10minutes.email'),
  ('app.gozora.site'),
  ('bankwen.com'),
  ('beta.pendulum.cyou'),
  ('boffweb.com'),
  ('bscse.tkp.edu.rs'),
  ('bseee.tkp.edu.rs'),
  ('clixer.lat'),
  ('concu.net'),
  ('dbieu.com'),
  ('digeros.com'),
  ('drtall.com'),
  ('dustmail.net'),
  ('edurao.com'),
  ('emailkeep.com'),
  ('en2ch.com'),
  ('fan.starlight.store'),
  ('glate.org'),
  ('gozora.site'),
  ('hello.kuromee.store'),
  ('javafs.com'),
  ('kuromee.com'),
  ('kuromee.store'),
  ('macsnipe.com'),
  ('mail.tm'),
  ('mnbvc.lat'),
  ('never-mind.edurao.com'),
  ('nilufa.kuromee.com'),
  ('ogzmail.com'),
  ('ozvmail.com'),
  ('pendulum.cyou'),
  ('rapidletter.net'),
  ('rozpi.com'),
  ('skimu.org'),
  ('starlight.store'),
  ('testinator.email'),
  ('theboys.cyou'),
  ('tsobe.com'),
  ('vgmale.com'),
  ('vought.theboys.cyou'),
  ('zelnro.com')
ON CONFLICT DO NOTHING;

DELETE FROM public.disposable_email_domains
WHERE domain IN ('private.icloud.com', 'privaterelay.appleid.com');
