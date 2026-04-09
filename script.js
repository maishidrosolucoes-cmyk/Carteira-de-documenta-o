// Inicialização do Supabase
const supabaseUrl = 'https://clbpujmdjbywbuevhyhg.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNsYnB1am1kamJ5d2J1ZXZoeWhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyOTA3NTUsImV4cCI6MjA4OTg2Njc1NX0.3vwMm8mLEcg9nPzH2uyrB65mzxN_NMvvaLSn2OxKAxo';

let supabaseClient = null;

try {
  if (supabaseUrl.startsWith('http://') || supabaseUrl.startsWith('https://')) {
    // Configuração do esquema 'documentos' globalmente no momento da criação do cliente
    supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey, {
      db: { schema: 'documentos' }
    });
  }
} catch (error) {
  console.error("Erro crítico ao carregar Supabase:", error);
}

// Registo oficial do componente Alpine para evitar erros de inicialização em produção
document.addEventListener('alpine:init', () => {
  Alpine.data('dashboard', () => ({
    documentos: [],
    categoriasApi: [],
    resumoApi: {},
    loading: false,
    errorMessage: '', // Variável para guardar e mostrar erros na interface
    search: '',
    statusFilter: '',
    categoriaFilter: '',
    selected: null,
    showExportModal: false, // NOVO ESTADO: Controla a visibilidade do modal de exportação

    async init() {
      // Bloqueia o scroll da página principal quando o modal abre
      this.$watch('selected', (value) => {
        if (value) {
          document.body.classList.add('overflow-hidden');
        } else {
          document.body.classList.remove('overflow-hidden');
        }
      });
      
      await this.carregar();
    },

    async carregar() {
      this.loading = true;
      this.errorMessage = ''; // Limpa os erros anteriores
      try {
        if (!supabaseClient) {
           console.warn("Ignorando busca no banco pois o Supabase não está configurado.");
           this.documentos = [];
           return;
        }

        // Como o esquema já foi definido globalmente acima, chamamos apenas o from()
        const { data, error } = await supabaseClient
          .from('vw_documentos_status')
          .select('*');

        if (error) throw error;

        // MOTOR DE REGRAS JS: Aplica as regras de 90 dias e Documento Vitalício
        this.documentos = (data || []).map(doc => {
          const dias = doc.dias_restantes != null ? doc.dias_restantes : doc.diasRestantes;
          
          if (doc.vencimento && doc.vencimento.includes('2999')) {
            doc.is_vitalicio = true;
            doc.status_prazo = 'em_dia'; // Mantém como 'em dia' para contabilizar nos cards corretamente
          } else {
            doc.is_vitalicio = false;
            if (dias != null) {
              if (dias < 0) doc.status_prazo = 'vencido';
              else if (dias <= 90) doc.status_prazo = 'vence_em_breve'; // Regra estrita de 90 dias
              else doc.status_prazo = 'em_dia';
            }
          }
          return doc;
        });
        
      } catch (e) {
        console.error('Erro ao carregar documentos do Supabase:', e.message);
        // Guarda a mensagem de erro para mostrar visualmente ao utilizador
        this.errorMessage = e.message; 
      } finally {
        this.loading = false;
      }
    },

    limparFiltros() {
      this.search = '';
      this.statusFilter = '';
      this.categoriaFilter = '';
    },

    // --- NOVA FUNÇÃO DE EXPORTAÇÃO DE RELATÓRIO (CSV) ---
    exportarCSV() {
      const docs = this.filteredDocumentos;
      if (docs.length === 0) {
        alert("Nenhum documento encontrado para exportar.");
        return;
      }

      // Cabeçalho do CSV
      let csv = "Apelido;Orgao Expedidor;Categoria;Vencimento;Dias Restantes;Status\n";

      // Formatação das linhas extraindo apenas o essencial
      docs.forEach(doc => {
        const apelido = doc.apelido || '-';
        const orgao = doc.orgao_expeditor || doc.orgaoExpeditor || '-';
        const categoria = doc.categoria || '-';
        const vencimento = this.formatDate(doc.vencimento);
        const dias = doc.is_vitalicio ? 'Vitalicio' : (doc.dias_restantes != null ? doc.dias_restantes : (doc.diasRestantes != null ? doc.diasRestantes : '-'));
        const status = this.labelStatus(doc);

        // Limpeza de campos rigorosa à prova de bugs no VSCode (usando concatenação simples)
        const linha = [apelido, orgao, categoria, vencimento, dias, status]
          .map(campo => '"' + String(campo).split('"').join('""') + '"')
          .join(';');
        
        csv += linha + "\n";
      });

      // Criação do ficheiro (.csv) com codificação UTF-8 e BOM para preservar acentos no Excel
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      
      const dataAtual = new Date().toISOString().split('T')[0];
      link.setAttribute("download", "Controle_Documentos_" + dataAtual + ".csv");
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // Fecha o modal após o clique
      this.showExportModal = false;
    },

    // --- NOVA FUNÇÃO DE EXPORTAÇÃO PARA WHATSAPP (RESUMO POR CATEGORIA) ---
    exportarWhatsApp() {
      const categorias = this.resumoCategorias;
      if (categorias.length === 0) {
        alert("Nenhum dado encontrado para enviar.");
        return;
      }

      let textoRelatorio = "*Resumo de Documentações por Categoria* 📊\n\n";

      categorias.forEach(cat => {
        textoRelatorio += `*${cat.categoria}*\n`;
        textoRelatorio += `🔴 Atrasado: ${cat.vencido} | 🟡 Breve: ${cat.venceEmBreve} | 🟢 OK: ${cat.emDia}\n\n`;
      });

      textoRelatorio += `_Total geral de documentos: ${this.stats.total}_`;

      // Cria a URL e abre a nova janela com a API do WhatsApp
      const urlBase = "https://api.whatsapp.com/send?text=";
      const urlFinal = urlBase + encodeURIComponent(textoRelatorio);
      window.open(urlFinal, '_blank');

      // Fecha o modal após a abertura do link
      this.showExportModal = false;
    },
    // --- FIM DA NOVA FUNÇÃO ---

    scrollToLista(status) {
      this.statusFilter = status;
      document.getElementById('documentos-section').scrollIntoView({ behavior: 'smooth' });
    },

    get filteredDocumentos() {
      const pesos = { 'vencido': 1, 'vence_em_breve': 2, 'em_dia': 3 };

      return this.documentos.filter(doc => {
        const texto = (doc.apelido || doc.documento || '') + ' ' + (doc.orgao_expeditor || doc.orgaoExpeditor || '') + ' ' + (doc.categoria || '') + ' ' + (doc.tipo_doc || doc.tipo_documento || doc.tipoDocumento || '');
        const bateBusca = texto.toLowerCase().includes(this.search.toLowerCase());
        const status = doc.status_prazo || doc.statusPrazo;
        const bateStatus = !this.statusFilter || status === this.statusFilter;
        const bateCategoria = !this.categoriaFilter || doc.categoria === this.categoriaFilter;
        return bateBusca && bateStatus && bateCategoria;
      }).sort((a, b) => {
        const statusA = a.status_prazo || a.statusPrazo;
        const statusB = b.status_prazo || b.statusPrazo;
        const pesoA = pesos[statusA] || 4;
        const pesoB = pesos[statusB] || 4;
        
        if (pesoA !== pesoB) return pesoA - pesoB;
        
        // Empurra os vitalícios para o fim da lista dos "Em dia"
        const getDias = (d) => d.is_vitalicio ? 999999 : (d.dias_restantes != null ? d.dias_restantes : (d.diasRestantes != null ? d.diasRestantes : 999999));
        return getDias(a) - getDias(b);
      });
    },

    get stats() {
      const listaBase = this.documentos.filter(doc => {
        const texto = (doc.apelido || doc.documento || '') + ' ' + (doc.orgao_expeditor || doc.orgaoExpeditor || '') + ' ' + (doc.categoria || '') + ' ' + (doc.tipo_doc || doc.tipo_documento || doc.tipoDocumento || '');
        const bateBusca = texto.toLowerCase().includes(this.search.toLowerCase());
        const bateCategoria = !this.categoriaFilter || doc.categoria === this.categoriaFilter;
        return bateBusca && bateCategoria;
      });

      return {
        total: listaBase.length,
        emDia: listaBase.filter(d => (d.status_prazo || d.statusPrazo) === 'em_dia').length,
        venceEmBreve: listaBase.filter(d => (d.status_prazo || d.statusPrazo) === 'vence_em_breve').length,
        vencido: listaBase.filter(d => (d.status_prazo || d.statusPrazo) === 'vencido').length
      };
    },

    get categoriasUnicas() {
      return [...new Set(this.documentos.map(d => d.categoria).filter(Boolean))].sort();
    },

    get resumoCategorias() {
      const mapa = {};

      this.filteredDocumentos.forEach(doc => {
        const categoria = doc.categoria || 'Sem categoria';
        const status = doc.status_prazo || doc.statusPrazo;

        if (!mapa[categoria]) {
          mapa[categoria] = { categoria, total: 0, emDia: 0, venceEmBreve: 0, vencido: 0 };
        }

        mapa[categoria].total++;
        if (status === 'em_dia') mapa[categoria].emDia++;
        if (status === 'vence_em_breve') mapa[categoria].venceEmBreve++;
        if (status === 'vencido') mapa[categoria].vencido++;
      });

      return Object.values(mapa).sort((a, b) => b.total - a.total);
    },
    
    // --- Helpers de UI simplificados e inteligentes ---
    
    labelStatus(doc) {
      if (!doc) return '-';
      if (doc.is_vitalicio) return 'Vitalício';
      const status = doc.status_prazo || doc.statusPrazo;
      if (status === 'vencido') return 'Vencido';
      if (status === 'vence_em_breve') return 'Prestes a vencer';
      return 'Em dia';
    },

    badgeClass(doc) {
      if (!doc) return '';
      if (doc.is_vitalicio) return 'bg-blue-100 text-blue-700'; // Crachá azul exclusivo para Vitalício
      const status = doc.status_prazo || doc.statusPrazo;
      if (status === 'vencido') return 'bg-rose-100 text-rose-700';
      if (status === 'vence_em_breve') return 'bg-amber-100 text-amber-700';
      return 'bg-emerald-100 text-emerald-700';
    },

    urgenciaDiasClass(doc) {
      if (!doc) return '';
      if (doc.is_vitalicio) return 'text-blue-700 font-medium';
      const dias = doc.dias_restantes != null ? doc.dias_restantes : doc.diasRestantes;
      if (dias == null) return '';
      if (dias < 0) return 'text-rose-700 font-bold';
      if (dias <= 90) return 'text-amber-700 font-bold';
      return 'text-slate-800 font-medium';
    },

    formatDias(doc) {
      if (!doc) return '-';
      if (doc.is_vitalicio) return 'Vitalício';
      const dias = doc.dias_restantes != null ? doc.dias_restantes : doc.diasRestantes;
      return dias != null ? dias : '-';
    },

    formatDiasTexto(doc) {
      if (!doc) return '-';
      if (doc.is_vitalicio) return 'Vitalício (Não vence)';
      const dias = doc.dias_restantes != null ? doc.dias_restantes : doc.diasRestantes;
      return dias != null ? dias + ' dias restantes' : '-';
    },

    formatDate(date) {
      if (!date) return '-';
      if (date.includes('2999')) return 'Vitalício';
      return new Date(date + 'T00:00:00').toLocaleDateString('pt-BR');
    }
  }));
});
