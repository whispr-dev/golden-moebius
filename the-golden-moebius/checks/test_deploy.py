from __future__ import annotations
import hashlib
from contextlib import redirect_stdout
import importlib.util
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("golden_deploy", ROOT / "deploy/deploy-server.py")
deployment = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = deployment
spec.loader.exec_module(deployment)


class ConfigurationTests(unittest.TestCase):
    def test_caddy_tokens_preserve_placeholders_quotes_and_comments(self):
        nodes = deployment.parse('''# { comment }
{ email admin@example.com
}
yt.cafe, www.yt.cafe {
 tls {env.EMAIL} {
  dns cloudflare {$TOKEN}
 }
 header X-Example "a # quoted value"
 root * /var/www/old
 file_server
}
''', True)
        self.assertEqual(len(nodes), 2)
        self.assertEqual(nodes[1].children[0].words, ["tls", "{env.EMAIL}"])
        self.assertEqual(nodes[1].children[0].children[0].words[-1], "{$TOKEN}")
        self.assertEqual(nodes[1].children[1].words[-1], "a # quoted value")

    def test_nginx_nested_blocks_and_braced_variables(self):
        text = 'http { server { server_name yt.cafe; root /var/www/old; location / { proxy_set_header Host ${host}; } } }'
        node = list(deployment.walk(deployment.parse(text)))
        self.assertEqual([n.name for n in node], ["http", "server", "server_name", "root", "location", "proxy_set_header"])
        self.assertEqual(node[-1].words[-1], "${host}")

    def caddy(self, source, extra=None, already=True):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        root = Path(temporary.name); config = root / "Caddyfile"; config.write_text(source)
        if extra:
            for name, text in extra.items():
                path = root / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_text(text)
        def command(args, **kwargs):
            if args[0] == "systemctl": return "path=/usr/bin/caddy ; argv[]=/usr/bin/caddy run --config " + str(config)
            if args[1] == "adapt": return json.dumps({"hosts": ["yt.cafe"] if already else []})
            raise AssertionError(args)
        with patch.object(deployment, "command", side_effect=command), patch.object(deployment.shutil, "which", return_value="/usr/bin/caddy"):
            plans, validator = deployment.caddy_plan(root / "diagnostics")
        return root, config, plans, validator

    def test_caddy_changes_only_selected_site_and_keeps_tls_and_auth(self):
        other = 'other.example {\n reverse_proxy localhost:9000\n}\n'
        source = other + 'yt.cafe {\n tls /etc/cert.pem /etc/key.pem\n basic_auth {\n owner hash\n }\n header X-Test safe\n reverse_proxy localhost:8000\n}\n'
        _, config, plans, validator = self.caddy(source)
        self.assertTrue(plans[config].startswith(other))
        self.assertIn("tls /etc/cert.pem /etc/key.pem", plans[config])
        self.assertIn("basic_auth", plans[config]); self.assertIn("header X-Test safe", plans[config])
        self.assertNotIn("localhost:8000", plans[config])
        self.assertIn("root * /var/www/the-golden-moebius/current", plans[config])
        self.assertEqual(config.read_text(), source, "planning must not mutate sources")
        self.assertIn("validate", validator)

    def test_caddy_imported_virtual_host_is_updated_in_its_own_file(self):
        root, config, plans, _ = self.caddy('import sites/*\n', {"sites/yt.conf": "yt.cafe {\n root * /srv/old\n file_server\n}\n"})
        self.assertNotIn(config, plans)
        self.assertIn(root / "sites/yt.conf", plans)

    def test_caddy_missing_site_is_appended_without_touching_other_hosts(self):
        source = "other.example {\n file_server\n}\n"
        _, config, plans, _ = self.caddy(source, already=False)
        self.assertTrue(plans[config].startswith(source))
        self.assertIn("yt.cafe {", plans[config])

    def test_caddy_refuses_host_blocks_shared_with_another_site(self):
        with self.assertRaisesRegex(RuntimeError, "another hostname"):
            self.caddy("yt.cafe, unrelated.example {\n file_server\n}\n")

    def test_caddy_refuses_snippets_inside_the_selected_site(self):
        with self.assertRaisesRegex(RuntimeError, "imports a snippet"):
            self.caddy("yt.cafe {\n import shared_auth\n file_server\n}\n")

    def test_caddy_refuses_nested_authentication(self):
        with self.assertRaisesRegex(RuntimeError, "authentication"):
            self.caddy("yt.cafe {\n handle {\n basic_auth {\n owner hash\n }\n reverse_proxy localhost:8000\n }\n}\n")

    def test_caddy_refuses_generated_host_it_cannot_locate(self):
        with self.assertRaisesRegex(RuntimeError, "unsupported Caddy import/template"):
            self.caddy("(a_template) {\n file_server\n}\n")

    def nginx(self, source):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        root = Path(temporary.name); config = root / "nginx.conf"; config.write_text(source)
        def command(args, **kwargs):
            if args[0] == "systemctl": return "path=/usr/sbin/nginx"
            if "-T" in args: return "# configuration file " + str(config) + ":\n" + source
            raise AssertionError(args)
        with patch.object(deployment, "command", side_effect=command), patch.object(deployment.shutil, "which", return_value="/usr/sbin/nginx"):
            plans, validator = deployment.nginx_plan(root / "diagnostics")
        return config, plans, validator

    def test_nginx_keeps_other_hosts_redirects_tls_and_acme(self):
        other = 'server { server_name other.example; location / { proxy_pass http://localhost:9999; } }'
        redirect = 'server { listen 80; server_name yt.cafe; return 301 https://$host$request_uri; }'
        source = other + '\n' + redirect + '\nserver { listen 443 ssl; server_name yt.cafe; ssl_certificate /etc/cert.pem; ssl_certificate_key /etc/key.pem; root /srv/old; location / { proxy_pass http://localhost:8000; } location /.well-known/acme-challenge/ { root /srv/acme; allow all; } }'
        config, plans, validator = self.nginx(source)
        text = plans[config]
        self.assertIn(other, text); self.assertIn(redirect, text)
        self.assertIn("ssl_certificate_key /etc/key.pem", text)
        self.assertIn("root /srv/acme", text); self.assertNotIn("localhost:8000", text)
        self.assertIn("try_files $uri $uri/ =404", text)
        self.assertIn("location ^~ /api/west-bank/",text)
        self.assertIn("proxy_pass http://127.0.0.1:8791;",text)
        self.assertIn("/current/public;",text)
        self.assertEqual(config.read_text(), source); self.assertIn("-t", validator)

    def test_nginx_refuses_a_shared_server_block(self):
        with self.assertRaisesRegex(RuntimeError, "another hostname"):
            self.nginx('server { server_name yt.cafe unrelated.example; root /srv/old; }')

    def test_nginx_refuses_location_access_controls_and_auth_subrequests(self):
        for directive in ['location / { auth_basic "Private"; }', 'auth_request /auth;']:
            with self.subTest(directive=directive), self.assertRaisesRegex(RuntimeError, "authentication|access controls"):
                self.nginx('server { server_name yt.cafe; ' + directive + ' }')

    def test_nginx_refuses_missing_or_redirect_only_hosts(self):
        for source in ['server { server_name other.example; }', 'server { server_name yt.cafe; return 301 https://other.example; }']:
            with self.assertRaisesRegex(RuntimeError, "No editable"):
                self.nginx(source)

    def test_parser_rejects_malformed_sources(self):
        for source in ['server { root /srv/a;', 'server { root "unclosed; }', 'server { root /srv/a }', '}']:
            with self.subTest(source=source), self.assertRaises(ValueError): deployment.parse(source)


class ArchiveTests(unittest.TestCase):
    def archive(self, members, manifest=None):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        root = Path(temporary.name); archive = root / "site.tar.gz"
        if manifest is None:
            manifest = {name: hashlib.sha256(data).hexdigest() for name, data, kind in members if kind == "file"}
        content = list(members) + [("manifest-sha256.json", json.dumps(manifest).encode(), "file")]
        with tarfile.open(archive, "w:gz") as bundle:
            for name, data, kind in content:
                item = tarfile.TarInfo(name)
                if kind == "link": item.type = tarfile.SYMTYPE; item.linkname = "/etc/passwd"; bundle.addfile(item)
                else: item.size = len(data); bundle.addfile(item, io.BytesIO(data))
        return archive, root / "release"

    def test_valid_release_is_verified_and_extracted_with_readable_permissions(self):
        archive, target = self.archive([("index.html", b"hello", "file"), ("assets/a.js", b"script", "file")])
        deployment.extract_release(archive, target)
        self.assertEqual((target / "index.html").read_bytes(), b"hello")
        self.assertEqual((target / "assets/a.js").stat().st_mode & 0o777, 0o644)

    def test_archive_rejects_traversal_absolute_paths_links_and_duplicates(self):
        for name, kind in [("../escape", "file"), ("/etc/escape", "file"), ("a\\b", "file"), ("link", "link")]:
            archive, target = self.archive([(name, b"payload", kind)])
            with self.subTest(name=name), self.assertRaises(ValueError): deployment.extract_release(archive, target)
            self.assertFalse(target.exists())
        archive, target = self.archive([("same", b"one", "file"), ("same", b"two", "file")])
        with self.assertRaisesRegex(ValueError, "Duplicate"): deployment.extract_release(archive, target)

    def test_archive_rejects_hash_mismatch_and_invalid_manifest(self):
        archive, target = self.archive([("index.html", b"hello", "file")], {"index.html": "0" * 64})
        with self.assertRaisesRegex(ValueError, "checksum mismatch"): deployment.extract_release(archive, target)
        for manifest in [[], {"index.html": "not-a-digest"}, {}]:
            archive, target = self.archive([("index.html", b"hello", "file")], manifest)
            with self.assertRaises(ValueError): deployment.extract_release(archive, target)


class TransactionTests(unittest.TestCase):
    def fixture(self):
        temporary=tempfile.TemporaryDirectory();self.addCleanup(temporary.cleanup)
        root=Path(temporary.name);base=root/'www';base.mkdir();backups=root/'backups'
        config=root/'Caddyfile';config.write_text('old configuration\n')
        previous=base/'old-release';previous.mkdir();(previous/'index.html').write_text('old site')
        current=base/'current';current.symlink_to(previous,target_is_directory=True)
        archive=root/'site.tar.gz'
        files={'public/'+name:b'new site' for name in ('index.html','viewer/index.html','viewer/play.html','gold-rush/index.html','gold-rush/play.html','west-bank/index.html','west-bank/play.html','assets/site.css')}
        files['leaderboard/server.mjs']=b'// service'
        files['leaderboard/verify.mjs']=b'// verifier'
        files['public/site-version.json']=json.dumps({'build':'0123456789abcdef','version':'1.0.0'}).encode()
        manifest={name:hashlib.sha256(data).hexdigest() for name,data in files.items()}
        files['manifest-sha256.json']=json.dumps(manifest).encode()
        with tarfile.open(archive,'w:gz') as bundle:
            for name,data in files.items():
                item=tarfile.TarInfo(name);item.size=len(data);bundle.addfile(item,io.BytesIO(data))
        digest=hashlib.sha256(archive.read_bytes()).hexdigest()
        return root,base,backups,config,previous,current,archive,digest

    def invoke(self, fixture, *, fail_reload=False, invalid_hash=False, fail_health=False, prior_active=False):
        root,base,backups,config,previous,current,archive,digest=fixture
        failed=False
        def command(args,**kwargs):
            nonlocal failed
            if fail_reload and args==['systemctl','reload','caddy'] and not failed:
                failed=True;raise RuntimeError('simulated reload failure')
            return ''
        real_open=open
        def local_open(path,*args,**kwargs):
            return real_open(root/'lock' if str(path)=='/var/lock/the-golden-moebius.lock' else path,*args,**kwargs)
        argv=['deploy-server.py','--apply','--archive',str(archive),'--sha256',('0'*64 if invalid_hash else digest)]
        with patch.object(deployment,'UNIT',root/'leaderboard.service'),patch.object(deployment,'STATE',root/'state'),patch.object(deployment,'backend_preflight',return_value='/usr/bin/node'),patch.object(deployment,'service_state',return_value={'active':prior_active,'enabled':prior_active}),patch.object(deployment,'check_backend',side_effect=RuntimeError('health failed') if fail_health else None),patch.object(deployment,'BASE',base),patch.object(deployment,'CURRENT',current),patch.object(deployment,'BACKUPS',backups),patch.object(deployment.os,'geteuid',return_value=0),patch.object(deployment,'selected_server',return_value='caddy'),patch.object(deployment,'caddy_plan',return_value=({config:'new configuration\n'},['fake-validator'])),patch.object(deployment,'command',side_effect=command),patch.object(deployment,'open',side_effect=local_open,create=True),patch.object(sys,'argv',argv),redirect_stdout(io.StringIO()):
            return deployment.main()

    def test_success_installs_a_verified_release_and_keeps_old_files_and_backup(self):
        fixture=self.fixture();self.assertEqual(self.invoke(fixture),0)
        root,base,backups,config,previous,current,archive,digest=fixture
        self.assertEqual(config.read_text(),'new configuration\n')
        self.assertNotEqual(current.resolve(),previous)
        self.assertEqual((current/'public/index.html').read_bytes(),b'new site')
        self.assertIn(deployment.UNIT_MARKER,(root/'leaderboard.service').read_text())
        self.assertEqual((previous/'index.html').read_text(),'old site')
        backup=next(backups.iterdir())
        self.assertEqual((backup/'config-0.backup').read_text(),'old configuration\n')
        self.assertTrue((backup/'deploy-server.py').is_file())

    def test_reload_failure_restores_config_and_previous_release(self):
        fixture=self.fixture()
        with self.assertRaisesRegex(RuntimeError,'were restored'):self.invoke(fixture,fail_reload=True)
        root,base,backups,config,previous,current,archive,digest=fixture
        self.assertEqual(config.read_text(),'old configuration\n');self.assertEqual(current.resolve(),previous)
        self.assertEqual((current/'index.html').read_text(),'old site')
        self.assertTrue(next(backups.iterdir()).is_dir())
        self.assertFalse((root/'leaderboard.service').exists())

    def test_backend_health_failure_restores_previous_site_and_service(self):
        fixture=self.fixture()
        root,base,backups,config,previous,current,archive,digest=fixture
        (root/'leaderboard.service').write_text(deployment.UNIT_MARKER+'\nold service')
        state=root/'state';state.mkdir();(state/'leaderboard.json').write_text('earned scores')
        with self.assertRaisesRegex(RuntimeError,'were restored'):
            self.invoke(fixture,fail_health=True,prior_active=True)
        self.assertEqual(current.resolve(),previous)
        self.assertEqual(config.read_text(),'old configuration\n')
        self.assertEqual((root/'leaderboard.service').read_text(),deployment.UNIT_MARKER+'\nold service')
        self.assertEqual((state/'leaderboard.json').read_text(),'earned scores')
        backup=next(backups.iterdir())
        self.assertEqual((backup/'leaderboard-state/leaderboard.json').read_text(),'earned scores')
        self.assertTrue(json.loads((backup/'restore.json').read_text())['leaderboard']['active'])

    def test_bad_transfer_hash_stops_before_configuration_or_release_changes(self):
        fixture=self.fixture()
        with self.assertRaisesRegex(ValueError,'checksum mismatch'):self.invoke(fixture,invalid_hash=True)
        root,base,backups,config,previous,current,archive,digest=fixture
        self.assertEqual(config.read_text(),'old configuration\n');self.assertEqual(current.resolve(),previous)
        self.assertFalse(backups.exists());self.assertFalse((base/'releases').exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
