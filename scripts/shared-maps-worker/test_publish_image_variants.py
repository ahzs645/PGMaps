import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import httpx

spec=importlib.util.spec_from_file_location('publish_image_variants',Path(__file__).with_name('publish_image_variants.py'))
p=importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)


class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.config={'endpoint':'https://maps.example.invalid','shareId':'x'*43,'uploadToken':'synthetic-owner-token'}
        self.base=self.config['endpoint']+'/c/'+self.config['shareId']+'/'
        self.before={'schema':'raster-catalog-v1','items':[{'id':'map-a','bounds':[0,0,1,1],'assets':[{'url':'tiles/existing.pmtiles'}],'download':{'url':'raw/existing.tif','sha256':'1'*64,'bytes':123},'georeferenceProject':{'sourceSha256':'2'*64}}],'featured':[],'storageBytes':123}
        self.after=copy.deepcopy(self.before)
        self.payload=b'synthetic-source-image'
        self.sha=hashlib.sha256(self.payload).hexdigest()
        self.key=f'raw/{self.sha}.png'
        self.after['items'][0]['imageVariants']=[{'id':'source-a','label':'Original image','role':'original-scan','image':{'url':self.base+self.key,'width':16,'height':12,'sha256':self.sha,'bytes':len(self.payload),'mimeType':'image/png'}}]
        self.after['items'][0]['download'].update(role='rectified',width=16,height=12)
        (self.root/'raw').mkdir()
        (self.root/self.key).write_bytes(self.payload)
        self.manifest={'objects':[{'key':self.key,'path':self.key,'sha256':self.sha,'bytes':len(self.payload),'contentType':'image/png'}]}
        (self.root/'manifest.json').write_text(json.dumps(self.manifest))
        self.stage={'schema':'pgmaps-image-variant-publication-v1','beforeCatalogue':'before.json','afterCatalogue':'after.json','collectionBase':self.base,'uploadManifests':['manifest.json']}
        self.write_stage()

    def write_stage(self):
        for name,value in [('before',self.before),('after',self.after)]:
            (self.root/f'{name}.json').write_text(json.dumps(value))
            self.stage[name+'Sha256']=p.digest(self.root/f'{name}.json')
        (self.root/'stage.json').write_text(json.dumps(self.stage))

    def client(self,*,race=False,weak_etag=False,wrong_existing=False,reject_match=False,already_active=False):
        self.puts=[]
        state={'catalogue':(self.root/'before.json').read_bytes(),'reads':0,'objects':{}}
        if already_active:state['catalogue']=(self.root/'after.json').read_bytes()
        if wrong_existing:state['objects'][self.key]=(b'wrong',{'sha256':'0'*64,'bytes':5})
        def handle(request):
            key=request.url.path.split('/'+self.config['shareId']+'/',1)[-1]
            if request.method=='GET' and key=='catalog.json':
                state['reads']+=1
                content=state['catalogue']
                if race and state['reads']==2:content=b'{"changed":true}'
                return httpx.Response(200,content=content,headers={'ETag':'W/"before"' if weak_etag else '"before"'})
            if request.method=='HEAD':
                if key not in state['objects']:return httpx.Response(404)
                body,entry=state['objects'][key]
                return httpx.Response(200,headers={'X-Content-SHA256':entry['sha256'],'Content-Length':str(entry['bytes'])})
            if request.method=='PUT':
                self.assertEqual(request.headers['Authorization'],'Bearer synthetic-owner-token')
                body=request.read();entry={'sha256':hashlib.sha256(body).hexdigest(),'bytes':len(body)}
                self.assertEqual(request.headers['X-Content-SHA256'],entry['sha256'])
                if key=='catalog.json':
                    self.assertEqual(request.headers['If-Match'],'"before"')
                    if reject_match:return httpx.Response(412)
                    state['catalogue']=body
                self.puts.append(key);state['objects'][key]=(body,entry)
                return httpx.Response(200,json=entry)
            raise AssertionError((request.method,key))
        return httpx.Client(transport=httpx.MockTransport(handle))

    def test_assets_then_conditional_catalogue_with_readback(self):
        with self.client() as client:
            receipt=p.publish(self.root/'stage.json',self.config,client=client)
        self.assertTrue(receipt['activated'])
        self.assertEqual(self.puts,[self.key,'catalog.json'])
        self.assertEqual(receipt['verifiedObjectCount'],1)
        self.assertFalse(receipt['geometryChanged'])

    def test_changed_live_catalogue_during_upload_is_not_overwritten(self):
        with self.client(race=True) as client,self.assertRaisesRegex(ValueError,'changed during upload'):
            p.publish(self.root/'stage.json',self.config,client=client)
        self.assertEqual(self.puts,[self.key])

    def test_geometry_or_saved_project_changes_are_rejected_before_network(self):
        for key,value in [('bounds',[2,2,3,3]),('georeferenceProject',{'sourceSha256':'3'*64})]:
            with self.subTest(key=key):
                self.after['items'][0][key]=value;self.write_stage()
                with self.assertRaisesRegex(ValueError,'geography, maps or saved projects'):p.validate_stage(self.root/'stage.json')
                self.after['items'][0][key]=copy.deepcopy(self.before['items'][0][key])

    def test_changed_local_asset_is_rejected(self):
        (self.root/self.key).write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError,'prepared object differs'):p.validate_stage(self.root/'stage.json')

    def test_existing_content_address_is_never_overwritten_on_mismatch(self):
        with self.client(wrong_existing=True) as client,self.assertRaisesRegex(RuntimeError,'checksum or byte count'):
            p.publish(self.root/'stage.json',self.config,client=client)
        self.assertEqual(self.puts,[])

    def test_weak_catalogue_etag_cannot_activate(self):
        with self.client(weak_etag=True) as client,self.assertRaisesRegex(ValueError,'strong live catalogue ETag'):
            p.publish(self.root/'stage.json',self.config,client=client)
        self.assertNotIn('catalog.json',self.puts)

    def test_mismatched_owner_collection_is_rejected(self):
        config={**self.config,'shareId':'y'*43}
        with self.assertRaisesRegex(ValueError,'different collection'):
            p.publish(self.root/'stage.json',config)

    def test_catalogue_body_is_the_same_snapshot_that_passed_its_hash(self):
        after_path=self.root/'after.json'
        expected=after_path.read_bytes()
        reads=[]
        read_bytes=Path.read_bytes
        def read_once(path):
            if path==after_path:
                reads.append(path)
                return expected if len(reads)==1 else b'{"changed":true}'
            return read_bytes(path)
        with patch.object(Path,'read_bytes',read_once):
            _,body,_=p.validate_stage(self.root/'stage.json')
        self.assertEqual(body,expected)
        self.assertEqual(len(reads),1)

    def test_new_source_files_must_match_manifest_and_collection(self):
        image=self.after['items'][0]['imageVariants'][0]['image']
        for field,value in [('url','https://different.example.org/image.png'),('sha256','f'*64),('bytes',len(self.payload)+1),('mimeType','image/jpeg')]:
            with self.subTest(field=field):
                old=image[field];image[field]=value;self.write_stage()
                with self.assertRaisesRegex(ValueError,'match a staged immutable object'):
                    p.validate_stage(self.root/'stage.json')
                image[field]=old

    def test_existing_source_variants_cannot_be_removed_or_replaced(self):
        variant=copy.deepcopy(self.after['items'][0]['imageVariants'][0])
        self.before['items'][0]['imageVariants']=[variant]
        for changed in ([],[{**variant,'label':'A different identity'}]):
            with self.subTest(changed=bool(changed)):
                self.after['items'][0]['imageVariants']=changed;self.write_stage()
                with self.assertRaisesRegex(ValueError,'preserve every existing image variant'):
                    p.validate_stage(self.root/'stage.json')

    def test_invalid_source_variant_link_is_rejected_before_network(self):
        self.after['items'][0]['download']['sourceVariantId']='unavailable-source'
        self.write_stage()
        with self.assertRaisesRegex(ValueError,'unavailable source-image variant'):
            p.validate_stage(self.root/'stage.json')

    def test_receipt_cannot_overwrite_a_staged_catalogue_or_object(self):
        for path in (self.root/'stage.json',self.root/'after.json',self.root/'manifest.json',self.root/self.key):
            with self.subTest(path=path.name):
                with self.assertRaisesRegex(ValueError,'preserve every staged input'):
                    p.publish(self.root/'stage.json',self.config,receipt_path=path)

    def test_precondition_failure_never_reports_activation(self):
        receipt_path=self.root/'receipt.json'
        with self.client(reject_match=True) as client,self.assertRaisesRegex(RuntimeError,'HTTP 412'):
            p.publish(self.root/'stage.json',self.config,client=client,receipt_path=receipt_path)
        self.assertEqual(self.puts,[self.key])
        self.assertFalse(json.loads(receipt_path.read_text())['activated'])

    def test_already_active_catalogue_verifies_objects_without_a_catalogue_write(self):
        with self.client(already_active=True) as client:
            receipt=p.publish(self.root/'stage.json',self.config,client=client)
        self.assertTrue(receipt['activated'])
        self.assertTrue(receipt['alreadyActive'])
        self.assertEqual(self.puts,[self.key])

    def test_http_errors_are_sanitized_and_receipt_does_not_contain_owner_token(self):
        def fail(request):
            raise httpx.ConnectError('synthetic-owner-token plus private request URL',request=request)
        with httpx.Client(transport=httpx.MockTransport(fail)) as client:
            with self.assertRaisesRegex(RuntimeError,'Owner HTTP request failed') as error:
                p.publish(self.root/'stage.json',self.config,client=client)
        self.assertNotIn(self.config['uploadToken'],str(error.exception))
        self.assertTrue(error.exception.__suppress_context__)
        receipt_path=self.root/'receipts'/'published.json'
        with self.client() as client:
            p.publish(self.root/'stage.json',self.config,client=client,receipt_path=receipt_path)
        self.assertNotIn(self.config['uploadToken'],receipt_path.read_text())
        self.assertNotIn(self.config['shareId'],receipt_path.read_text())


if __name__=='__main__':unittest.main()
