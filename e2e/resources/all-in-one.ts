import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** First-party fixture for the explicit live all-in-one benchmark, never customer data. */
export const featureRequest = `Implement the signal-cycle editing feature in this existing Java 21 / Spring Boot and Vue application.
The business rules are in BUSINESS.md. Add PUT /api/intersections/{id}/signal-cycle accepting {signalCycle: number}.
Allow integer multiples of 5 from 30 through 180 inclusive; fractional JSON numbers must return 400 rather than being rounded. Invalid input returns 400, unknown IDs return 404.
Return the updated signalCycle in the successful PUT response. Persist the updated cycle and an audit entry with oldCycle, newCycle and changedAt. Add GET /api/intersections/{id}/history returning a JSON array.
In the existing Vue screen, let the user select an intersection, edit its cycle and save. Show successful state and a visible validation error. Preserve the existing list and read endpoints.
Add meaningful backend tests. Do not change BUSINESS.md, remove assertions or fabricate successful checks. Work only in this imported project. Build/test the actual application and report what ran.`;

export const refactorRequest = `Rename SignalService.getSignalCycle(long) to findSignalCycle(long) and update its real Java call sites and tests. Preserve HTTP paths, response data, business behavior and stored data. Do not rename similarly named text in BUSINESS.md. Run the real Maven tests and report the result.`;

export async function createTrafficFixture(root: string): Promise<void> {
  const files: Record<string, string> = {
    '.gitignore': 'backend/target/\nbackend/data/\n.m2/\nfrontend/node_modules/\nfrontend/dist/\n.idea/\n*.iml\n',
    'BUSINESS.md': `# Demonstration traffic-control system\n\nThis is synthetic evaluation data, not traffic-law guidance or a customer system.\n\n## Intersection\nIDs 1 and 2 initially have cycles of 60 and 90 seconds. The cycle may be an integer multiple of 5 from 30 through 180 seconds inclusive. Updating an unknown ID returns 404; invalid cycles return 400. Updates persist across server restarts. Each successful update records old/new cycle and a timestamp in history. Invalid requests do not change data or history.\n\n## Screen\nThe operator selects an intersection, reads its current cycle, edits and saves. Show a visible success message and keep the refreshed value. Show a visible error on invalid input. API and screen descriptions must distinguish these written business rules from observed source/runtime evidence.\n\n## Refactor control\nThe phrase getSignalCycle in this paragraph is documentation text and must remain unchanged by a Java symbol rename.\n`,
    'backend/pom.xml': `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <parent><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-parent</artifactId><version>3.5.7</version><relativePath/></parent>
  <groupId>example</groupId><artifactId>traffic-control</artifactId><version>1.0.0</version>
  <properties><java.version>21</java.version></properties>
  <dependencies>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-data-jpa</artifactId></dependency>
    <dependency><groupId>com.h2database</groupId><artifactId>h2</artifactId><scope>runtime</scope></dependency>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-test</artifactId><scope>test</scope></dependency>
  </dependencies>
  <build><plugins><plugin><groupId>org.springframework.boot</groupId><artifactId>spring-boot-maven-plugin</artifactId></plugin></plugins></build>
</project>`,
    'backend/src/main/resources/application.properties': `server.address=127.0.0.1
server.port=8080
spring.datasource.url=jdbc:h2:file:./data/traffic
spring.datasource.username=sa
spring.datasource.password=
spring.jpa.hibernate.ddl-auto=update
spring.jpa.open-in-view=false
`,
    'backend/src/main/java/example/traffic/TrafficApplication.java': `package example.traffic;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.CommandLineRunner;
import org.springframework.context.annotation.Bean;
@SpringBootApplication
public class TrafficApplication {
  public static void main(String[] args) { SpringApplication.run(TrafficApplication.class, args); }
  @Bean CommandLineRunner seed(IntersectionRepository repository) { return args -> {
    if (repository.count() == 0) { repository.save(new Intersection(1L,"Central",60)); repository.save(new Intersection(2L,"South",90)); }
  }; }
}
`,
    'backend/src/main/java/example/traffic/Intersection.java': `package example.traffic;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
@Entity @Table(name="intersections")
public class Intersection {
  @Id private Long id;
  private String name;
  private int signalCycle;
  protected Intersection() {}
  public Intersection(Long id,String name,int cycle){this.id=id;this.name=name;this.signalCycle=cycle;}
  public Long getId(){return id;}
  public String getName(){return name;}
  public int getSignalCycle(){return signalCycle;}
  public void setSignalCycle(int cycle){this.signalCycle=cycle;}
}
`,
    'backend/src/main/java/example/traffic/IntersectionRepository.java': `package example.traffic;
import org.springframework.data.jpa.repository.JpaRepository;
public interface IntersectionRepository extends JpaRepository<Intersection,Long> {}
`,
    'backend/src/main/java/example/traffic/SignalService.java': `package example.traffic;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;
import java.util.List;
@Service
public class SignalService {
  private final IntersectionRepository repository;
  public SignalService(IntersectionRepository repository){this.repository=repository;}
  public List<Intersection> list(){return repository.findAll();}
  public int getSignalCycle(long id){
    Intersection intersection=repository.findById(id).orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND,"Intersection not found"));
    return intersection.getSignalCycle();
  }
}
`,
    'backend/src/main/java/example/traffic/SignalController.java': `package example.traffic;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.PathVariable;
import java.util.List;
import java.util.Map;
@RestController @RequestMapping("/api/intersections")
public class SignalController {
  private final SignalService service;
  public SignalController(SignalService service){this.service=service;}
  @GetMapping public List<Intersection> list(){return service.list();}
  @GetMapping("/{id}/signal-cycle") public Map<String,Integer> cycle(@PathVariable long id){return Map.of("signalCycle",service.getSignalCycle(id));}
}
`,
    'backend/src/test/java/example/traffic/SignalServiceTest.java': `package example.traffic;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import java.util.Optional;
class SignalServiceTest {
  @Test void readsExistingCycle(){
    IntersectionRepository repository=mock(IntersectionRepository.class);
    when(repository.findById(1L)).thenReturn(Optional.of(new Intersection(1L,"Central",60)));
    assertEquals(60,new SignalService(repository).getSignalCycle(1L));
  }
}
`,
    'frontend/package.json': JSON.stringify({ name: 'traffic-operator', version: '1.0.0', private: true, type: 'module', scripts: { dev: 'vite --host 127.0.0.1', build: 'vite build' }, dependencies: { vue: '3.5.43', axios: '1.12.2' }, devDependencies: { vite: '7.1.7', typescript: '5.9.3', '@vitejs/plugin-vue': '6.0.1' } }, null, 2),
    'frontend/index.html': '<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Traffic Operator</title></head><body><div id="app"></div><script type="module" src="/src/main.ts"></script></body></html>',
    'frontend/vite.config.ts': `import {defineConfig} from 'vite';\nimport vue from '@vitejs/plugin-vue';\nexport default defineConfig({plugins:[vue()],server:{port:5173,strictPort:true,proxy:{'/api':'http://127.0.0.1:8080'}}});\n`,
    'frontend/src/main.ts': `import { createApp } from 'vue';\nimport App from './App.vue';\ncreateApp(App).mount('#app');\n`,
    'frontend/src/App.vue': `<script setup lang="ts">
import {onMounted,ref} from 'vue';
import axios from 'axios';
type Intersection={id:number;name:string;signalCycle:number};
const intersections=ref<Intersection[]>([]);
const selected=ref(1);
const current=ref<number|null>(null);
const error=ref('');
async function refresh(){
  try{intersections.value=(await axios.get('/api/intersections')).data;await readCycle();error.value='';}
  catch{error.value='Could not load intersections';}
}
async function readCycle(){current.value=(await axios.get('/api/intersections/'+selected.value+'/signal-cycle')).data.signalCycle;}
onMounted(refresh);
</script>
<template>
 <main><header><span class="eyebrow">OPERATOR WORKSPACE</span><h1>Traffic signal control</h1><p>Existing Java/Spring and Vue project · demonstration data</p></header>
 <section><h2>Intersection</h2><label for="intersection">Select intersection</label><select id="intersection" v-model="selected" @change="readCycle"><option v-for="item in intersections" :key="item.id" :value="item.id">{{item.name}}</option></select>
 <div class="current"><span>Current cycle</span><strong>{{current??'—'}}<small> seconds</small></strong></div>
 <button @click="refresh">Refresh</button><p role="alert" v-if="error">{{error}}</p></section>
 <aside><h2>Legacy behavior</h2><p>This baseline reads cycles. Editing and history are not yet implemented.</p></aside>
 </main>
</template>
<style>
*{box-sizing:border-box}body{margin:0;background:#edf2f7;color:#172033;font:16px system-ui,sans-serif}main{max-width:1000px;margin:auto;padding:44px}header{margin-bottom:28px}.eyebrow{font-size:12px;font-weight:700;letter-spacing:.15em;color:#52708c}h1{font-size:36px;margin:10px 0}header p,aside p{color:#617188}section,aside{background:white;border:1px solid #dce4ef;border-radius:14px;padding:28px;margin-bottom:20px}h2{margin-top:0;font-size:20px}label{display:block;margin:12px 0 6px}select,input{font:inherit;border:1px solid #b8c7db;border-radius:7px;padding:10px;max-width:420px;width:100%}button{font:inherit;border:0;border-radius:7px;background:#215ce1;color:white;padding:11px 22px;cursor:pointer}.current{display:flex;justify-content:space-between;align-items:center;margin:22px 0;padding:20px;background:#f2f6ff;border-radius:10px}.current strong{font-size:32px}.current small{font-size:14px;color:#617188}[role=alert]{color:#a92435}
</style>
`,
  };
  for (const [name, source] of Object.entries(files)) {
    const target = path.join(root, name); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, source);
  }
}
